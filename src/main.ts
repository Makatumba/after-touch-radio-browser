import './styles.css';
import {refresh, render} from './app';

render();
refresh('top').catch(console.error);
