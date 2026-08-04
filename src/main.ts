import './styles.css';
import {refresh, render, state, loadFilterOptions} from './app';
import {setupEvents} from './events';
import {checkSoundtouchOnStartup} from './soundtouch-ws';

render();
setupEvents();
refresh('top').catch(console.error);
loadFilterOptions();

if (state.soundtouchAddress) { checkSoundtouchOnStartup(state.soundtouchAddress); }
