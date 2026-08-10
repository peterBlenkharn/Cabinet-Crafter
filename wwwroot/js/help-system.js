import {
    getFindingHelp,
    getHelpTopic,
    getParameterHelp,
    listHelpTopics,
    searchHelpTopics
} from './help-registry.js';

const DEFAULT_TOPIC_IDS = [
    'guide.getting-started',
    'guide.workflow-status',
    'guide.visibility',
    'guide.findings',
    'guide.before-you-cut',
    'guide.keyboard',
    'guide.units'
];

const QUICK_HELP_KEYS = new Set([
    'width', 'height', 'depth', 'thickness', 'cpHeight', 'cpDepth', 'cpAngle',
    'frontApronDrop', 'monitorAngle', 'screenWidth', 'screenHeight',
    'screenBezelMargin', 'controlProfileSupportCount', 'includeDisplayBottomSupport',
    'includeHeaderSupport', 'screwDiameter', 'screwLength', 'exploded'
]);

function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
}

function topicForControl(control) {
    if (control.dataset.param) return getParameterHelp(control.dataset.param, 'parameter');
    if (control.dataset.controlParam) return getParameterHelp(control.dataset.controlParam, 'control');
    if (control.dataset.componentParam) return getParameterHelp(control.dataset.componentParam, 'component');
    return null;
}

function helpKindLabel(topic) {
    if (topic.kind === 'finding') return 'Finding';
    if (topic.kind === 'guide') return 'Guide';
    return topic.domain === 'component' ? 'Part setting' : topic.domain === 'controls' ? 'Control setting' : 'Setting';
}

export class HelpSystem {
    constructor(ui) {
        this.ui = ui;
        this.dialog = document.getElementById('help-dialog');
        this.opener = document.getElementById('btn-help');
        this.search = document.getElementById('help-search');
        this.list = document.getElementById('help-topic-list');
        this.content = document.getElementById('help-topic-content');
        this.activeTopicId = null;
        this.returnFocus = null;
        this.hideTimer = null;
        this.tooltip = this.createTooltip();
        this.bind();
        this.enhanceControlHelp();
        this.observeFindings();
        this.renderTopicList(this.defaultTopics());
    }

    bind() {
        this.opener?.addEventListener('click', () => this.open());
        document.getElementById('btn-close-help')?.addEventListener('click', () => this.close());
        this.dialog?.addEventListener('cancel', event => {
            event.preventDefault();
            this.close();
        });
        this.dialog?.addEventListener('close', () => {
            const target = this.returnFocus;
            this.returnFocus = null;
            if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
        });
        this.search?.addEventListener('input', () => {
            const query = this.search.value.trim();
            this.renderTopicList(query ? searchHelpTopics(query, { limit: 40 }) : this.defaultTopics());
        });
        this.search?.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this.list?.querySelector('button')?.focus();
            }
        });
        this.list?.addEventListener('click', event => {
            const button = event.target.closest('[data-help-topic]');
            if (button) this.openTopic(button.dataset.helpTopic, { preserveSearch: true });
        });
        this.content?.addEventListener('click', event => {
            const button = event.target.closest('[data-help-topic]');
            if (button) this.openTopic(button.dataset.helpTopic, { preserveSearch: true });
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'F1') {
                event.preventDefault();
                const control = document.activeElement?.closest?.('[data-param], [data-control-param], [data-component-param]');
                const topic = control ? topicForControl(control) : null;
                if (topic) this.openTopic(topic.id);
                else this.open();
            }
            if (event.key === 'Escape') this.hideTooltip();
        });
    }

    defaultTopics() {
        const topics = DEFAULT_TOPIC_IDS.map(getHelpTopic).filter(Boolean);
        return topics.length ? topics : listHelpTopics({ kind: 'guide' });
    }

    open() {
        if (!this.dialog) return;
        if (!this.dialog.open) this.returnFocus = document.activeElement;
        if (!this.activeTopicId) this.renderTopic(getHelpTopic('guide.getting-started') || this.defaultTopics()[0]);
        if (!this.dialog.open) {
            if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
            else this.dialog.setAttribute('open', '');
        }
        window.setTimeout(() => this.search?.focus(), 0);
    }

    close() {
        if (!this.dialog?.open) return;
        if (typeof this.dialog.close === 'function') this.dialog.close();
        else this.dialog.removeAttribute('open');
    }

    openTopic(idOrAlias, { preserveSearch = false } = {}) {
        const topic = getHelpTopic(idOrAlias);
        if (!topic) {
            this.ui.showNotification?.(`No help topic is available for ${idOrAlias}.`, {
                severity: 'warning',
                title: 'Help topic unavailable'
            });
            return false;
        }
        if (!preserveSearch && this.search) {
            this.search.value = '';
            this.renderTopicList(this.defaultTopics());
        }
        this.renderTopic(topic);
        this.open();
        if (topic.id === 'guide.before-you-cut') {
            this.ui.recordLearningAction?.(this.ui.learningActions?.HELP_TOPIC_OPENED, { topic: 'before-you-cut' });
        }
        window.setTimeout(() => this.content?.focus(), 0);
        return true;
    }

    renderTopicList(topics) {
        if (!this.list) return;
        this.list.replaceChildren();
        if (!topics.length) {
            this.list.appendChild(createElement('p', 'section-hint', 'No help topics match this search.'));
            return;
        }
        topics.forEach(topic => {
            const button = createElement('button', 'help-topic-button');
            button.type = 'button';
            button.dataset.helpTopic = topic.id;
            button.classList.toggle('active', topic.id === this.activeTopicId);
            button.setAttribute('aria-current', topic.id === this.activeTopicId ? 'page' : 'false');
            button.append(
                createElement('strong', '', topic.title),
                createElement('span', '', `${helpKindLabel(topic)} | ${topic.tooltip}`)
            );
            this.list.appendChild(button);
        });
    }

    renderTopic(topic) {
        if (!topic || !this.content) return;
        this.activeTopicId = topic.id;
        this.list?.querySelectorAll('[data-help-topic]').forEach(button => {
            const active = button.dataset.helpTopic === topic.id;
            button.classList.toggle('active', active);
            button.setAttribute('aria-current', active ? 'page' : 'false');
        });
        this.content.replaceChildren();
        this.content.append(
            createElement('span', 'export-kicker', `${helpKindLabel(topic)} | ${topic.domain}`),
            createElement('h3', '', topic.title),
            createElement('p', 'help-topic-summary', topic.explanation)
        );

        const facts = document.createElement('dl');
        facts.className = 'help-topic-facts';
        const addFact = (label, value) => {
            if (!value || (Array.isArray(value) && !value.length)) return;
            facts.append(
                createElement('dt', '', label),
                createElement('dd', '', Array.isArray(value) ? value.join(', ') : value)
            );
        };
        addFact('Quick explanation', topic.tooltip);
        addFact('Units', topic.unit);
        addFact('Measured from', topic.origin);
        addFact('What it changes', topic.effects);
        addFact('Depends on', topic.dependencies);
        addFact('Used by', topic.downstream);
        addFact('Workshop check', topic.safety);
        if (facts.children.length) this.content.appendChild(facts);

        const relatedTopics = (topic.related || []).map(getHelpTopic).filter(Boolean);
        if (relatedTopics.length) {
            const section = createElement('section', 'help-related-topics');
            section.appendChild(createElement('h4', '', 'Related help'));
            const actions = createElement('div', 'help-related-actions');
            relatedTopics.forEach(related => {
                const button = createElement('button', 'btn btn-secondary btn-sm', related.title);
                button.type = 'button';
                button.dataset.helpTopic = related.id;
                actions.appendChild(button);
            });
            section.appendChild(actions);
            this.content.appendChild(section);
        }
    }

    enhanceControlHelp() {
        document.querySelectorAll('[data-param], [data-control-param], [data-component-param]').forEach(control => {
            const topic = topicForControl(control);
            if (!topic) return;
            control.dataset.helpTopic = topic.id;
            control.title = topic.tooltip;
            control.setAttribute('aria-description', topic.tooltip);
            const key = control.dataset.param || control.dataset.controlParam || control.dataset.componentParam;
            if (!QUICK_HELP_KEYS.has(key)) return;
            const group = control.closest('.control-group, .slider-inline');
            if (!group || group.querySelector(`.field-help-button[data-help-topic="${topic.id}"]`)) return;
            const button = createElement('button', 'field-help-button', '?');
            button.type = 'button';
            button.dataset.helpTopic = topic.id;
            button.setAttribute('aria-label', `Explain ${topic.title}`);
            button.addEventListener('pointerenter', () => this.showTooltip(button, topic));
            button.addEventListener('pointerleave', () => this.scheduleTooltipHide());
            button.addEventListener('focus', () => this.showTooltip(button, topic));
            button.addEventListener('blur', () => this.scheduleTooltipHide());
            button.addEventListener('click', () => this.openTopic(topic.id));
            group.appendChild(button);
        });
    }

    createTooltip() {
        let tooltip = document.getElementById('app-tooltip');
        if (!tooltip) {
            tooltip = createElement('div', 'app-tooltip');
            tooltip.id = 'app-tooltip';
            tooltip.setAttribute('role', 'tooltip');
            tooltip.hidden = true;
            tooltip.addEventListener('pointerenter', () => window.clearTimeout(this.hideTimer));
            tooltip.addEventListener('pointerleave', () => this.hideTooltip());
            document.body.appendChild(tooltip);
        }
        return tooltip;
    }

    showTooltip(anchor, topic) {
        if (!this.tooltip || !anchor || !topic) return;
        window.clearTimeout(this.hideTimer);
        this.tooltip.textContent = topic.tooltip;
        this.tooltip.hidden = false;
        anchor.setAttribute('aria-describedby', this.tooltip.id);
        const rect = anchor.getBoundingClientRect();
        const left = Math.min(window.innerWidth - this.tooltip.offsetWidth - 12, Math.max(12, rect.left));
        const top = rect.bottom + this.tooltip.offsetHeight + 12 < window.innerHeight
            ? rect.bottom + 7
            : Math.max(12, rect.top - this.tooltip.offsetHeight - 7);
        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.top = `${top}px`;
        this.tooltipAnchor = anchor;
    }

    scheduleTooltipHide() {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = window.setTimeout(() => this.hideTooltip(), 180);
    }

    hideTooltip() {
        window.clearTimeout(this.hideTimer);
        this.tooltipAnchor?.removeAttribute('aria-describedby');
        this.tooltipAnchor = null;
        if (this.tooltip) this.tooltip.hidden = true;
    }

    observeFindings() {
        const enhance = root => this.enhanceFindingHelp(root);
        enhance(document);
        if (typeof MutationObserver !== 'function') return;
        this.findingObserver = new MutationObserver(records => {
            records.forEach(record => record.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) enhance(node);
            }));
        });
        this.findingObserver.observe(document.body, { childList: true, subtree: true });
    }

    enhanceFindingHelp(root) {
        const candidates = [];
        if (root.matches?.('.issue-card, .maker-finding, .maker-review-finding')) candidates.push(root);
        root.querySelectorAll?.('.issue-card, .maker-finding, .maker-review-finding').forEach(card => candidates.push(card));
        candidates.forEach(card => {
            if (card.dataset.helpEnhanced === 'true') return;
            const code = card.dataset.findingCode
                || card.querySelector('.issue-code, [data-finding-code]')?.textContent?.trim();
            const topic = getFindingHelp(code);
            card.dataset.helpEnhanced = 'true';
            if (!topic) return;
            const button = createElement('button', 'finding-help-button', 'Explain');
            button.type = 'button';
            button.dataset.helpTopic = topic.id;
            button.setAttribute('aria-label', `Explain ${code}`);
            button.addEventListener('click', event => {
                event.stopPropagation();
                this.openTopic(topic.id);
            });
            card.appendChild(button);
        });
    }
}
