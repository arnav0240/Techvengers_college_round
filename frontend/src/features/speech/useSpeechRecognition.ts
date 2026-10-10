import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechSupport } from '../../types';

export interface SpeechAdapterState {
  support: SpeechSupport;
  listening: boolean;
  interim: string;
  finalText: string;
  error: string | null;
  lang: string;
}

interface Win extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error?: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [i: number]: { transcript: string };
  }>;
}

/**
 * Replaceable speech-recognition adapter. Defaults to Web Speech API.
 * Kept fully separate from the Web Audio visualisation path.
 */
export function useSpeechRecognition() {
  const [state, setState] = useState<SpeechAdapterState>(() => {
    const w = window as Win;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    return {
      support: Ctor ? 'supported' : 'unsupported',
      listening: false,
      interim: '',
      finalText: '',
      error: null,
      lang: 'en-US',
    };
  });
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const listeningRef = useRef(false);

  useEffect(() => {
    return () => {
      try { recRef.current?.abort(); } catch { /* noop */ }
    };
  }, []);

  const stop = useCallback(() => {
    listeningRef.current = false;
    try { recRef.current?.stop(); } catch { /* noop */ }
    setState((s) => ({ ...s, listening: false }));
  }, []);

  const start = useCallback(() => {
    const w = window as Win;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setState((s) => ({ ...s, support: 'unsupported', error: 'Speech recognition is not supported in this browser. You can still type commands and use microphone-reactive visuals.' }));
      return;
    }
    try { recRef.current?.abort(); } catch { /* noop */ }
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    listeningRef.current = true;
    setState((s) => ({ ...s, listening: true, interim: '', error: null }));

    rec.onresult = (ev) => {
      let interim = '';
      let finals = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0]?.transcript ?? '';
        if (r.isFinal) finals += t;
        else interim += t;
      }
      setState((s) => ({
        ...s,
        interim,
        finalText: finals ? (s.finalText ? s.finalText + ' ' + finals : finals) : s.finalText,
      }));
    };
    rec.onerror = (ev) => {
      const code = ev.error ?? 'unknown';
      let msg = 'Speech recognition error.';
      if (code === 'not-allowed' || code === 'service-not-allowed') msg = 'Microphone access for speech recognition was blocked. Check browser site permissions.';
      else if (code === 'no-speech') msg = 'No speech was detected. Try speaking closer to the microphone.';
      else if (code === 'audio-capture') msg = 'No microphone was found for speech recognition.';
      else if (code === 'network') msg = 'Speech recognition needs network access and failed.';
      setState((s) => ({ ...s, error: msg }));
    };
    rec.onend = () => {
      // Auto-restart while user still wants to listen (continuous dictation)
      if (listeningRef.current) {
        try { rec.start(); } catch {
          listeningRef.current = false;
          setState((s) => ({ ...s, listening: false }));
        }
      } else {
        setState((s) => ({ ...s, listening: false }));
      }
    };
    try {
      rec.start();
    } catch {
      listeningRef.current = false;
      setState((s) => ({ ...s, listening: false, error: 'Could not start speech recognition.' }));
    }
  }, []);

  const clear = useCallback(() => {
    setState((s) => ({ ...s, interim: '', finalText: '', error: null }));
  }, []);

  return { ...state, start, stop, clear, setLang: (lang: string) => setState((s) => ({ ...s, lang })) };
}
