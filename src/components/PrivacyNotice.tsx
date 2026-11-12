import React from 'react';
import { X, ShieldCheck } from 'lucide-react';

interface PrivacyNoticeProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PrivacyNotice: React.FC<PrivacyNoticeProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-bold text-zinc-100">Privacy &amp; Data Use</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 cursor-pointer"
            aria-label="Close privacy notice"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs leading-relaxed text-zinc-300">
          <section className="space-y-1.5">
            <h3 className="font-semibold text-zinc-100">What MeghSwara accesses</h3>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>
                <strong className="text-zinc-300">Google Drive (read-only)</strong> — to list the
                folder you choose and stream the audio files in it.
              </li>
              <li>
                <strong className="text-zinc-300">Google Drive (app files only)</strong> — to save
                and read <code>aetherhifi-library-index.json</code>, the library index MeghSwara
                creates. MeghSwara cannot modify or delete your other files.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-zinc-100">Where your data lives</h3>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Library metadata, cover thumbnails, playlists and lyrics: stored on this device (IndexedDB).</li>
              <li>The shared library index: stored in <em>your own</em> Google Drive.</li>
              <li>Tracks you pin for offline use: stored on this device only (Cache Storage).</li>
              <li>
                Your Google access token: kept in this browser for up to 1 hour and refreshed
                automatically. It is never stored on a server.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-zinc-100">What passes through servers</h3>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>
                <strong className="text-zinc-300">Audio streaming (Cloudflare):</strong> audio bytes
                are relayed from Google Drive to your device and are not stored or cached
                (<code>Cache-Control: no-store</code>).
              </li>
              <li>
                <strong className="text-zinc-300">Error reports (Cloudflare):</strong> when something
                breaks, MeghSwara sends the error message, browser/device type, screen size,
                connection type, and the affected track&apos;s Drive file ID, title and format.
                Access tokens are removed before saving. Reports are deleted automatically after 7
                days and are readable only by the app owner.
              </li>
              <li>
                <strong className="text-zinc-300">Lyrics (LRCLIB):</strong> the track&apos;s title,
                artist, album and duration are sent to lrclib.net to look up lyrics.
              </li>
            </ul>
          </section>

          <section className="space-y-1.5 p-3 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <h3 className="font-semibold text-zinc-100">Google API Limited Use disclosure</h3>
            <p className="text-zinc-400">
              MeghSwara&apos;s use and transfer of information received from Google APIs adheres to
              the{' '}
              <a
                href="https://developers.google.com/terms/api-services-user-data-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 hover:underline"
              >
                Google API Services User Data Policy
              </a>
              , including the Limited Use requirements. Google Drive data is used only to provide
              music playback and library features to you. It is not sold, not used for advertising,
              not shared with third parties except as described above, and not used to train AI
              models.
            </p>
          </section>

          <section className="space-y-1.5">
            <h3 className="font-semibold text-zinc-100">Your control</h3>
            <ul className="list-disc list-inside space-y-1 text-zinc-400">
              <li>Disconnect at any time from the Drive panel.</li>
              <li>
                Revoke access completely at{' '}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline"
                >
                  myaccount.google.com/permissions
                </a>
                .
              </li>
              <li>Clear on-device data with &quot;Purge Audio Cache&quot; or by clearing site data in your browser.</li>
            </ul>
          </section>

          <p className="text-[11px] text-zinc-500">
            MeghSwara plays files from your own Google Drive. You are responsible for having the
            right to the music you store there. MeghSwara is not affiliated with or endorsed by
            Google.
          </p>
        </div>
      </div>
    </div>
  );
};
