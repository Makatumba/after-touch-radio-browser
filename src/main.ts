import './styles.css';
import {refresh, render, state, loadFilterOptions} from './app';
import {setupEvents} from './events';
import {checkSoundtouchOnStartup} from './soundtouch-ws';

render();
setupEvents();
refresh('top').catch(console.error);
loadFilterOptions();

// Wave 12: the startup probe/WS sequence runs only when speaker control is
// enabled — the OFF gate lives at this call site (not inside the check), so
// direct checkSoundtouchOnStartup() invocations keep working.
if (state.settings.enableSpeakerControl && state.soundtouchAddress) { checkSoundtouchOnStartup(state.soundtouchAddress); }
