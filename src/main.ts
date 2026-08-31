import './styles.css';
import {refresh, render, state, loadFilterOptions} from './app';
import {setupEvents} from './events';
import {checkSoundtouchOnStartup} from './soundtouch-ws';
import {isCordovaRuntime} from './runtime';
import {setupResumeRecheck} from './soundtouch-resume';

render();
setupEvents();
refresh('top').catch(console.error);
loadFilterOptions();

// Cordova-wrapper support: expose the detected runtime on the document so the
// native shell's device tests can verify which bundle path booted (criterion:
// "the remote app bundle knows whether it is running in Cordova"). There are
// no PWA-only registration points to gate today — see src/runtime.ts.
document.documentElement.dataset.afterTouchRuntime = isCordovaRuntime() ? 'cordova' : 'web';

if (state.soundtouchAddress) { checkSoundtouchOnStartup(state.soundtouchAddress); }
setupResumeRecheck();
