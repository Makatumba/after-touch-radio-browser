import type {State} from '../state';

export function renderPlayerBar(state: State, t: Record<string, string>): string {
    return `<section class="panel player">
    <div class="player-top">
        <div><strong>${state.nowPlaying}</strong><small>${state.playerMeta}</small></div>
        <div class="status">${state.status}</div>
    </div>
</section>`;
}
