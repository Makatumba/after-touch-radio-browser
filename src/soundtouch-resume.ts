import { render, state } from './app';
import { isCordovaRuntime } from './runtime';
import { pingSoundtouch, sanitizeHost } from './actions';
import { connectSoundtouchWs, requestSnapshot } from './soundtouch-ws';
import { cancelSendConfirmation } from './confirmation';

let installed = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastVisibilityHidden = false;

let resumeHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let pageShowHandler: ((e: Event) => void) | null = null;

function shouldRecheck(): boolean {
    const host = sanitizeHost(state.soundtouchAddress ?? '');
    if (!host) return false;
    if (state.soundtouchStatus === 'checking') return false;
    if (state.soundtouchStatus === 'available' && state.wsStatus === 'connected') return false;
    return true;
}

function scheduleRecheck(): void {
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void triggerRecheck();
    }, 500);
}

async function triggerRecheck(): Promise<void> {
    if (!shouldRecheck()) return;
    const host = sanitizeHost(state.soundtouchAddress);
    if (!host) return;
    state.soundtouchStatus = 'checking';
    render();
    const ok = await pingSoundtouch(host);
    if (sanitizeHost(state.soundtouchAddress) !== host) return;
    if (ok) {
        state.soundtouchStatus = 'available';
        render();
        requestSnapshot();
        connectSoundtouchWs(host);
    } else {
        state.soundtouchStatus = 'unreachable';
        cancelSendConfirmation();
        render();
    }
}

export function setupResumeRecheck(): void {
    if (installed) return;
    installed = true;
    if (isCordovaRuntime()) {
        resumeHandler = () => scheduleRecheck();
        document.addEventListener('resume', resumeHandler);
    } else {
        visibilityHandler = () => {
            const vs = (document as unknown as { visibilityState?: string }).visibilityState;
            if (vs === 'hidden') {
                lastVisibilityHidden = true;
                return;
            }
            if (vs === 'visible') {
                if (lastVisibilityHidden) {
                    lastVisibilityHidden = false;
                    scheduleRecheck();
                }
                return;
            }
        };
        pageShowHandler = (e: Event) => {
            const ev = e as unknown as { persisted?: boolean };
            if (ev.persisted) scheduleRecheck();
        };
        document.addEventListener('visibilitychange', visibilityHandler);
        window.addEventListener('pageshow', pageShowHandler);
    }
}

export function cancelPendingResumeCheck(): void {
    if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    }
}

export function resetResumeStateForTests(): void {
    cancelPendingResumeCheck();
    lastVisibilityHidden = false;
    if (installed) {
        if (resumeHandler) {
            document.removeEventListener('resume', resumeHandler);
            resumeHandler = null;
        }
        if (visibilityHandler) {
            document.removeEventListener('visibilitychange', visibilityHandler);
            visibilityHandler = null;
        }
        if (pageShowHandler) {
            window.removeEventListener('pageshow', pageShowHandler);
            pageShowHandler = null;
        }
        installed = false;
    }
}
