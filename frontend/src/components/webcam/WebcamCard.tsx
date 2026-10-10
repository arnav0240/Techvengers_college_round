import { useEffect, useRef } from 'react';
import { Camera, CameraOff, Loader2, ShieldAlert } from 'lucide-react';
import type { CameraStatus, TrackingState } from '../../types';

export default function WebcamCard({
  status,
  error,
  stream,
  tracking,
  onEnable,
  onDisable,
  mini = false,
}: {
  status: CameraStatus;
  error: string | null;
  stream: MediaStream | null;
  tracking: TrackingState;
  onEnable: () => void;
  onDisable: () => void;
  mini?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (stream) {
      v.srcObject = stream;
      v.play().catch(() => undefined);
    } else {
      v.srcObject = null;
    }
  }, [stream]);

  if (mini) {
    return (
      <div className="nova-panel nova-transition w-[176px] shrink-0 rounded-xl p-1.5 lg:w-[196px]" aria-label="Camera preview">
        <div className="mb-1 flex items-center justify-between px-0.5">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-[#9AA7CB]">CAMERA</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold ${
              status === 'active' ? 'bg-emerald-400/10 text-[#31E8C0]' : status === 'requesting' ? 'bg-blue-400/10 text-[#39D8FF]' : 'bg-white/5 text-[#68769A]'
            }`}
            role="status"
          >
            <span className={`h-1 w-1 rounded-full ${status === 'active' ? 'bg-[#31E8C0]' : status === 'requesting' ? 'animate-pulse bg-[#39D8FF]' : 'bg-[#68769A]'}`} />
            {status === 'active' ? 'CAM LIVE' : status === 'requesting' ? 'Starting…' : status === 'denied' ? 'Blocked' : status === 'off' ? 'Off' : status}
          </span>
        </div>
        <div className="relative aspect-video overflow-hidden rounded-lg border border-[#5A78FF]/25 bg-black">
          {status === 'active' && stream ? (
            <video ref={videoRef} muted playsInline autoPlay className="h-full w-full -scale-x-100 object-cover" aria-label="Live camera preview" />
          ) : (
            <video ref={videoRef} muted playsInline className="hidden" />
          )}
          {status !== 'active' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1 text-center">
              {status === 'requesting' ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#39D8FF]" />
              ) : (
                <CameraOff className="h-4 w-4 text-[#68769A]" />
              )}
              <p className="text-[10px] leading-tight text-[#9AA7CB]">
                {status === 'requesting' ? 'Requesting…' : status === 'denied' ? 'Permission denied' : status === 'unavailable' ? 'No camera' : 'Camera off'}
              </p>
            </div>
          )}
          {status === 'active' && (
            <span className="absolute left-1 top-1 inline-flex items-center gap-1 rounded bg-black/60 px-1 py-px text-[9px] font-bold text-[#31E8C0]">
              <span className="nova-live-dot h-1 w-1 rounded-full bg-[#31E8C0]" /> LIVE
            </span>
          )}
        </div>
        {error ? (
          <p className="mt-1 flex items-start gap-1 rounded-md bg-[#FF6488]/10 px-1.5 py-1 text-[10px] leading-tight text-[#FF6488]" role="alert">
            <ShieldAlert className="mt-px h-3 w-3 shrink-0" /> {error}
          </p>
        ) : (
          <button
            onClick={status === 'active' ? onDisable : onEnable}
            disabled={status === 'requesting'}
            className="nova-transition mt-1 inline-flex w-full items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-semibold focus-visible:outline-2 focus-visible:outline-[#39D8FF] disabled:opacity-50 ${
              status === 'active'
                ? 'border border-white/10 bg-white/5 text-[#F5F7FF] hover:bg-white/10'
                : 'bg-[#315BFF] text-white hover:brightness-110'
            }"
            aria-label={status === 'active' ? 'Turn camera off' : 'Turn camera on'}
          >
            {status === 'active' ? <CameraOff className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
            {status === 'active' ? 'Off' : status === 'requesting' ? 'Starting…' : 'Enable'}
          </button>
        )}
        {error && (
          <button
            onClick={status === 'active' ? onDisable : onEnable}
            className="nova-transition mt-1 inline-flex w-full items-center justify-center gap-1 rounded-lg bg-[#315BFF] px-1.5 py-1 text-[11px] font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          >
            <Camera className="h-3 w-3" /> Retry
          </button>
        )}
        <p className="mt-1 truncate px-0.5 text-[9px] text-[#68769A]" title={tracking.statusMessage}>
          Tracking: {tracking.available ? 'active' : 'unavailable'}
        </p>
      </div>
    );
  }

  return (
    <div className="nova-panel w-[248px] shrink-0 rounded-2xl p-2.5" aria-label="Camera preview">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold tracking-[0.18em] text-[#9AA7CB]">CAMERA</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            status === 'active' ? 'bg-emerald-400/10 text-[#31E8C0]' : status === 'requesting' ? 'bg-blue-400/10 text-[#39D8FF]' : 'bg-white/5 text-[#68769A]'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-[#31E8C0]' : status === 'requesting' ? 'animate-pulse bg-[#39D8FF]' : 'bg-[#68769A]'}`}
          />
          {status === 'active' ? 'CAM LIVE' : status === 'requesting' ? 'Starting…' : status === 'denied' ? 'Blocked' : status === 'off' ? 'Off' : status}
        </span>
      </div>

      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[#5A78FF]/25 bg-black">
        {status === 'active' && stream ? (
          <video ref={videoRef} muted playsInline autoPlay className="h-full w-full -scale-x-100 object-cover" aria-label="Live camera preview" />
        ) : (
          <video ref={videoRef} muted playsInline className="hidden" />
        )}
        {status !== 'active' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
            {status === 'requesting' ? (
              <Loader2 className="h-6 w-6 animate-spin text-[#39D8FF]" />
            ) : (
              <CameraOff className="h-6 w-6 text-[#68769A]" />
            )}
            <p className="text-xs leading-relaxed text-[#9AA7CB]">
              {status === 'requesting'
                ? 'Requesting camera…'
                : status === 'denied'
                  ? 'Permission denied'
                  : status === 'unavailable'
                    ? 'No camera device was found'
                    : 'Camera is off'}
            </p>
          </div>
        )}
        {status === 'active' && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-[#31E8C0]">
            <span className="nova-live-dot h-1.5 w-1.5 rounded-full bg-[#31E8C0]" /> REC
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[#FF6488]/10 px-2 py-1.5 text-[11px] leading-snug text-[#FF6488]" role="alert">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {status === 'active' ? (
          <button
            onClick={onDisable}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-medium text-[#F5F7FF] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          >
            <CameraOff className="h-3.5 w-3.5" /> Disable
          </button>
        ) : (
          <button
            onClick={onEnable}
            disabled={status === 'requesting'}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#315BFF] px-2 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[#39D8FF]"
          >
            <Camera className="h-3.5 w-3.5" /> {status === 'requesting' ? 'Starting…' : 'Enable camera'}
          </button>
        )}
      </div>

      <p className="mt-2 px-1 text-[10.5px] leading-snug text-[#68769A]" aria-live="polite">
        Tracking: {tracking.available ? `active (${Math.round((tracking.confidence ?? 0) * 100)}%)` : 'unavailable — camera only, no tracking results fabricated.'}
      </p>
    </div>
  );
}
