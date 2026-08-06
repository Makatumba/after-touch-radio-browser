// Material-style settings icon matching the remote-control icon pattern
// (24×24 viewBox, currentColor fill, aria-hidden, focusable=false).
const GEAR_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94l-0.36-2.54c-0.04-0.24-0.24-0.41-0.48-0.41h-3.84c-0.24,0-0.43,0.17-0.47,0.41l-0.36,2.54c-0.59,0.24-1.13,0.57-1.62,0.94l-2.39-0.96c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87c-0.12,0.21-0.08,0.47,0.12,0.61l2.03,1.58c-0.05,0.3-0.09,0.63-0.09,0.94s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94zM12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"/></svg>';

// Wave 6: the inline language switcher (chips + "Active language" label)
// moved into the settings popup — the header is brand + gear only.
export function renderHeader(t: Record<string, string>): string {
    return `<header class="topbar">
    <div class="brand">
        <img class="brand-mark" src="logo.png" alt="${t.logoAlt}" width="48" height="48">
        <div>
            <h1>${t.title}</h1>
            <p>${t.subtitle}</p>
        </div>
    </div>
    <div class="header-right">
        <button class="gear-btn" id="openSettings" title="${t.settingsTitle}">${GEAR_ICON}</button>
    </div>
</header>`;
}
