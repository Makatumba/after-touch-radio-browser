import './styles.css';
import {refresh, render, state, loadFilterOptions} from './app';
import {setupEvents} from './events';
import {pingSoundtouch} from './actions';
import {connectSoundtouchWs, requestSnapshot} from './soundtouch-ws';

render();
setupEvents();
refresh('top').catch(console.error);
loadFilterOptions();

if (state.soundtouchAddress) {
    const savedAddress = state.soundtouchAddress;
    state.soundtouchStatus = 'checking';
    connectSoundtouchWs(savedAddress);
    pingSoundtouch(savedAddress).then(ok => {
        if (state.soundtouchAddress === savedAddress) {
            state.soundtouchStatus = ok ? 'available' : 'unreachable';
            render();
            if (ok) requestSnapshot();
        }
    });
}
