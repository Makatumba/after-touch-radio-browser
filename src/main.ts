import './styles.css';
import {refresh, render} from './app';
import {setupEvents} from './events';

render();
setupEvents();
refresh('top').catch(console.error);
