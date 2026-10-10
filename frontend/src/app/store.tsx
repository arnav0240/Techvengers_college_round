import { createContext, useCallback, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { AppStatus, MicStatus, OrbVisualState } from '../types';
import type { AppView } from '../components/hud/TopBar';

interface AppStateCtx {
  appStatus: AppStatus;
  setAppStatus: Dispatch<SetStateAction<AppStatus>>;
  orbState: OrbVisualState;
  setOrbState: Dispatch<SetStateAction<OrbVisualState>>;
  micStatus: MicStatus;
  setMicStatus: Dispatch<SetStateAction<MicStatus>>;
  micError: string | null;
  setMicError: Dispatch<SetStateAction<string | null>>;
  micLevel: number;
  setMicLevel: Dispatch<SetStateAction<number>>;
  mode: 'expanded' | 'compact';
  setMode: Dispatch<SetStateAction<'expanded' | 'compact'>>;
  lastSubmitted: string | null;
  setLastSubmitted: Dispatch<SetStateAction<string | null>>;
  /** Active top-level tab (MAIN / SIMULATION), shared by both screens. */
  view: AppView;
  setView: Dispatch<SetStateAction<AppView>>;
}

const Ctx = createContext<AppStateCtx | null>(null);

const readInitialView = (): AppView => {
  if (typeof window === 'undefined') return 'main';
  try {
    return window.localStorage.getItem('nova.view') === 'simulation' ? 'simulation' : 'main';
  } catch {
    return 'main';
  }
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [appStatus, setAppStatus] = useState<AppStatus>('idle');
  const [orbState, setOrbState] = useState<OrbVisualState>('idle');
  const [micStatus, setMicStatus] = useState<MicStatus>('off');
  const [micError, setMicError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [mode, setMode] = useState<'expanded' | 'compact'>('expanded');
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);
  const [view, setViewRaw] = useState<AppView>(readInitialView);

  // Persist the selected tab across refreshes (best-effort; storage can be blocked).
  const setView = useCallback<Dispatch<SetStateAction<AppView>>>((v) => {
    setViewRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try {
        window.localStorage.setItem('nova.view', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      appStatus, setAppStatus,
      orbState, setOrbState,
      micStatus, setMicStatus,
      micError, setMicError,
      micLevel, setMicLevel,
      mode, setMode,
      lastSubmitted, setLastSubmitted,
      view, setView,
    }),
    [appStatus, orbState, micStatus, micError, micLevel, mode, lastSubmitted, view, setView],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppState must be used within AppStateProvider');
  return v;
}

export function useMicLevelReporter() {
  const { setMicLevel } = useAppState();
  return useCallback(
    (v: number) => {
      // throttle: only update React state ~8Hz for the level meter
      setMicLevel(v);
    },
    [setMicLevel],
  );
}
