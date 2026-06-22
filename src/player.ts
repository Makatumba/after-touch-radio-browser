let audio: HTMLAudioElement | null = null;

export function getAudioElement(): HTMLAudioElement {
    if (!audio) audio = new Audio();
    return audio;
}

export async function playStream(url: string): Promise<void> {
    const el = getAudioElement();
    el.pause();
    el.src = url;
    el.load();
    await el.play();
}

export function stopStream(): void {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
}
