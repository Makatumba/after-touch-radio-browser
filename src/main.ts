import './styles.css';
import {refresh, render, state, loadFilterOptions} from './app';
import {setupEvents} from './events';
import {pingSoundtouch} from './actions';

render();
setupEvents();
refresh('top').catch(console.error);
loadFilterOptions();

if (state.soundtouchAddress) {
    state.soundtouchStatus = 'checking';
    pingSoundtouch(state.soundtouchAddress).then(ok => {
        state.soundtouchStatus = ok ? 'available' : 'unreachable';
        render();
    });
}
