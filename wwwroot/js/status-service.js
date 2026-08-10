const DEFAULT_DURATION_MS = 3200;
const MAX_HISTORY = 50;

function normalizeSeverity(value) {
    return ['success', 'warning', 'error', 'info', 'busy'].includes(value) ? value : 'info';
}

function messageText(value, fallback = '') {
    return String(value ?? fallback).trim();
}

function makeId() {
    return `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class StatusService {
    constructor({ liveRegion, toastRegion, historyDialog, historyList, historyEmpty, historyButton } = {}) {
        this.liveRegion = liveRegion || null;
        this.toastRegion = toastRegion || null;
        this.historyDialog = historyDialog || null;
        this.historyList = historyList || null;
        this.historyEmpty = historyEmpty || null;
        this.historyButton = historyButton || null;
        this.entries = [];
        this.activeByKey = new Map();
        this.timers = new Map();
        this.returnFocus = null;
        this.bindHistoryDialog();
        this.renderHistory();
    }

    bindHistoryDialog() {
        this.historyButton?.addEventListener('click', () => this.openHistory());
        this.historyDialog?.querySelector('[data-status-close]')?.addEventListener('click', () => this.closeHistory());
        this.historyDialog?.querySelector('[data-status-clear]')?.addEventListener('click', () => this.clearResolved());
        this.historyDialog?.addEventListener('cancel', event => {
            event.preventDefault();
            this.closeHistory();
        });
        this.historyDialog?.addEventListener('close', () => {
            const target = this.returnFocus;
            this.returnFocus = null;
            if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
        });
    }

    notify(message, options = {}) {
        const severity = normalizeSeverity(options.severity);
        const persistent = options.persistent === true || severity === 'error';
        const key = messageText(options.key);
        const existing = key ? this.activeByKey.get(key) : null;
        const entry = existing || {
            id: makeId(),
            key,
            createdAt: new Date().toISOString(),
            resolved: false
        };
        entry.title = messageText(options.title, severity === 'error' ? 'Action needed' : 'Application status');
        entry.message = messageText(message);
        entry.detail = messageText(options.detail);
        entry.severity = severity;
        entry.persistent = persistent;
        entry.busy = severity === 'busy' || options.busy === true;
        entry.actions = Array.isArray(options.actions) ? options.actions.filter(action => action?.label && typeof action.run === 'function') : [];
        entry.updatedAt = new Date().toISOString();
        entry.resolved = false;

        if (!existing) {
            this.entries.unshift(entry);
            if (this.entries.length > MAX_HISTORY) this.entries.length = MAX_HISTORY;
        }
        if (key) this.activeByKey.set(key, entry);

        this.announce(entry);
        this.renderToast(entry, options.durationMs);
        this.renderHistory();
        return entry.id;
    }

    begin(key, message, options = {}) {
        return this.notify(message, {
            ...options,
            key,
            severity: 'busy',
            persistent: true,
            busy: true
        });
    }

    resolve(key, message, options = {}) {
        const active = this.activeByKey.get(key);
        if (active) {
            active.resolved = true;
            active.busy = false;
            active.updatedAt = new Date().toISOString();
            this.activeByKey.delete(key);
            this.removeToast(active.id);
        }
        if (message) return this.notify(message, { ...options, severity: options.severity || 'success' });
        this.renderHistory();
        return null;
    }

    fail(key, message, options = {}) {
        const active = key ? this.activeByKey.get(key) : null;
        if (active) {
            active.resolved = true;
            active.busy = false;
            active.updatedAt = new Date().toISOString();
            this.removeToast(active.id);
            this.activeByKey.delete(key);
        }
        return this.notify(message, { ...options, key, severity: 'error', persistent: true });
    }

    dismiss(id) {
        const entry = this.entries.find(candidate => candidate.id === id);
        if (entry) {
            entry.resolved = true;
            if (entry.key) this.activeByKey.delete(entry.key);
        }
        this.removeToast(id);
        this.renderHistory();
    }

    clearResolved() {
        this.entries = this.entries.filter(entry => !entry.resolved && (entry.persistent || entry.busy));
        this.renderHistory();
    }

    announce(entry) {
        if (!this.liveRegion || !entry.message) return;
        this.liveRegion.setAttribute('aria-live', entry.severity === 'error' ? 'assertive' : 'polite');
        this.liveRegion.textContent = `${entry.title}: ${entry.message}`;
    }

    renderToast(entry, requestedDuration) {
        if (!this.toastRegion || !entry.message) return;
        this.removeToast(entry.id);
        const toast = document.createElement('article');
        toast.className = `status-toast ${entry.severity}`;
        toast.dataset.statusId = entry.id;
        toast.setAttribute('aria-label', entry.title);

        const copy = document.createElement('div');
        copy.className = 'status-toast-copy';
        const title = document.createElement('strong');
        title.textContent = entry.title;
        const message = document.createElement('span');
        message.textContent = entry.message;
        copy.append(title, message);
        if (entry.detail) {
            const detail = document.createElement('small');
            detail.textContent = entry.detail;
            copy.append(detail);
        }
        toast.append(copy);

        if (entry.actions.length > 0) {
            const actions = document.createElement('div');
            actions.className = 'status-toast-actions';
            entry.actions.forEach(action => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'btn btn-secondary btn-sm';
                button.textContent = action.label;
                button.addEventListener('click', () => action.run(entry));
                actions.appendChild(button);
            });
            toast.appendChild(actions);
        }

        if (!entry.busy) {
            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'status-toast-dismiss';
            close.textContent = 'Dismiss';
            close.setAttribute('aria-label', `Dismiss ${entry.title}`);
            close.addEventListener('click', () => this.dismiss(entry.id));
            toast.appendChild(close);
        }

        const pause = () => this.pauseTimer(entry.id);
        const resume = () => this.resumeTimer(entry.id, requestedDuration);
        toast.addEventListener('pointerenter', pause);
        toast.addEventListener('pointerleave', resume);
        toast.addEventListener('focusin', pause);
        toast.addEventListener('focusout', resume);
        this.toastRegion.prepend(toast);
        if (!entry.persistent && !entry.busy) this.resumeTimer(entry.id, requestedDuration);
    }

    pauseTimer(id) {
        const timer = this.timers.get(id);
        if (timer) window.clearTimeout(timer);
        this.timers.delete(id);
    }

    resumeTimer(id, requestedDuration) {
        this.pauseTimer(id);
        const duration = Number.isFinite(Number(requestedDuration)) ? Math.max(1000, Number(requestedDuration)) : DEFAULT_DURATION_MS;
        this.timers.set(id, window.setTimeout(() => this.dismiss(id), duration));
    }

    removeToast(id) {
        this.pauseTimer(id);
        Array.from(this.toastRegion?.querySelectorAll('[data-status-id]') || [])
            .find(toast => toast.dataset.statusId === id)
            ?.remove();
    }

    openHistory() {
        if (!this.historyDialog) return;
        this.returnFocus = document.activeElement;
        this.renderHistory();
        if (typeof this.historyDialog.showModal === 'function') this.historyDialog.showModal();
        else this.historyDialog.setAttribute('open', '');
        window.setTimeout(() => this.historyDialog.querySelector('[data-status-close]')?.focus(), 0);
    }

    closeHistory() {
        if (!this.historyDialog?.open) return;
        if (typeof this.historyDialog.close === 'function') this.historyDialog.close();
        else this.historyDialog.removeAttribute('open');
    }

    renderHistory() {
        if (this.historyButton) {
            const unresolved = this.entries.filter(entry => !entry.resolved && (entry.severity === 'error' || entry.busy)).length;
            this.historyButton.dataset.count = String(unresolved);
            this.historyButton.setAttribute('aria-label', unresolved > 0 ? `Status and notifications, ${unresolved} need attention` : 'Status and notifications');
        }
        if (!this.historyList) return;
        this.historyList.replaceChildren();
        if (this.historyEmpty) this.historyEmpty.hidden = this.entries.length > 0;
        this.entries.forEach(entry => {
            const row = document.createElement('article');
            row.className = `status-history-entry ${entry.severity}${entry.resolved ? ' resolved' : ''}`;
            const heading = document.createElement('h3');
            heading.textContent = entry.title;
            const message = document.createElement('p');
            message.textContent = entry.message;
            const meta = document.createElement('small');
            const date = new Date(entry.updatedAt || entry.createdAt);
            meta.textContent = `${entry.resolved ? 'Resolved' : entry.busy ? 'In progress' : entry.severity} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            row.append(heading, message);
            if (entry.detail) {
                const detail = document.createElement('p');
                detail.className = 'status-history-detail';
                detail.textContent = entry.detail;
                row.appendChild(detail);
            }
            row.appendChild(meta);
            this.historyList.appendChild(row);
        });
    }
}

export function createStatusService(documentRef = document) {
    return new StatusService({
        liveRegion: documentRef.getElementById('hud-message'),
        toastRegion: documentRef.getElementById('status-toast-region'),
        historyDialog: documentRef.getElementById('status-history-dialog'),
        historyList: documentRef.getElementById('status-history-list'),
        historyEmpty: documentRef.getElementById('status-history-empty'),
        historyButton: documentRef.getElementById('btn-status-history')
    });
}
