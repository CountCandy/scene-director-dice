/*
 * Scene Director Dice — SillyTavern third-party UI extension
 *
 * Before each reply the extension resolves one "turn": it either rolls 1dX against
 * the active deck, plays a queued foreshadow payoff, or burns one cooldown turn.
 * The resulting directive is injected only for that generation (depth-0 extension
 * prompt, optionally plus a reasoning prefill) and removed again afterwards, so
 * nothing is ever written into chat messages or seen in later context.
 */

const MODULE_NAME = 'scene_director_dice';
const META_KEY = 'scene_director_dice';
const PROMPT_KEY = 'SCENE_DIRECTOR_DICE';
const LOG_PREFIX = '[Scene Director Dice]';

// Values of SillyTavern's extension_prompt_types / extension_prompt_roles.
// Depth only applies to the IN_CHAT position, so depth 0 has to use it.
const EXT_PROMPT_IN_CHAT = 1;
const EXT_ROLE_SYSTEM = 0;

const OUTCOME_LABEL = {
    steady: 'Steady',
    foreshadow: 'Foreshadow',
    twist: 'Twist',
};

const OUTCOME_OPTION_LABEL = {
    steady: 'Steady',
    foreshadow: 'Foreshadow',
    twist: 'Twist / Development',
};

const FALLBACK_STEADY_TEXT = 'Hold steady. Develop the current interaction naturally without forcing an external twist.';

const DEFAULT_COOLDOWN_DIRECTIVE = 'Cooldown active - hold steady. A significant development happened recently. Let its aftermath breathe: focus on reactions, consequences, and character interaction. Do not introduce any new random twists, threats, arrivals, or complications this turn.';

const DEFAULT_PAYOFF_DIRECTIVE = 'Payoff. Last turn\'s foreshadowing directive was: "{{foreshadow}}" Follow through on the warning cue planted last turn and trigger the complication now, as an active event in the scene.';

function makeDefaultGeneralRows() {
    return [
        { min: 1, max: 5, type: 'steady', text: 'Hold steady. Develop the current interaction naturally without forcing an external twist.' },
        { min: 6, max: 7, type: 'foreshadow', text: 'Foreshadow. Plant an ominous sensory cue or warning sign hinting at an approaching hazard, entity, or conflict.' },
        { min: 8, max: 8, type: 'twist', text: 'Hazard or Misfire. If logical for the setting, trigger a trap, environmental obstacle, or unstable magic/tech malfunction.' },
        { min: 9, max: 9, type: 'twist', text: 'NPC Friction. Spark a sudden disagreement, shift in agenda, or clash where an NPC acts autonomously or storms off.' },
        { min: 10, max: 10, type: 'twist', text: 'Intrusion / Escalation. Introduce an unexpected person, creature, or active threat into the scene.' },
    ];
}

function makeDefaultDecks() {
    return [
        { id: 'general', name: 'General Story', dieSize: 10, rows: makeDefaultGeneralRows() },
        {
            id: 'social',
            name: 'Social & Intrigue',
            dieSize: 10,
            rows: [
                { min: 1, max: 5, type: 'steady', text: 'Hold steady. Let the conversation unfold through subtext, body language, and character voice without outside interference.' },
                { min: 6, max: 7, type: 'foreshadow', text: 'Foreshadow. Plant a subtle tell - a glance held too long, an evasive answer, an overheard fragment - hinting at a hidden agenda or brewing social trouble.' },
                { min: 8, max: 8, type: 'twist', text: 'Revelation. If logical, let a secret, rumor, or inconvenient truth slip out and change the footing of the conversation.' },
                { min: 9, max: 9, type: 'twist', text: 'Shifting Loyalties. An NPC changes stance, makes an unexpected demand or offer, or pursues their own agenda against the current flow.' },
                { min: 10, max: 10, type: 'twist', text: 'Interruption. An uninvited person, urgent message, or public scene cuts in and raises the social stakes.' },
            ],
        },
        {
            id: 'dungeon',
            name: 'Dungeon & Hazards',
            dieSize: 10,
            rows: [
                { min: 1, max: 4, type: 'steady', text: 'Hold steady. Continue exploration at the current pace with grounded environmental detail.' },
                { min: 5, max: 6, type: 'foreshadow', text: 'Foreshadow. Plant a physical warning sign - fresh tracks, a cold draft, scorch marks, a distant sound - of a nearby hazard or lurking presence.' },
                { min: 7, max: 7, type: 'twist', text: 'Trap or Obstacle. If logical for the location, trigger a trap, collapse, blocked route, or environmental danger.' },
                { min: 8, max: 8, type: 'twist', text: 'Resource Strain. Light, supplies, gear, magic, or stamina falters or fails at an inconvenient moment.' },
                { min: 9, max: 9, type: 'twist', text: 'Discovery. Reveal a hidden passage, strange object, remains, or clue that changes the available options.' },
                { min: 10, max: 10, type: 'twist', text: 'Wandering Threat. A creature, patrol, or rival party enters the area or becomes aware of the characters.' },
            ],
        },
        {
            id: 'combat',
            name: 'Combat',
            dieSize: 10,
            rows: [
                { min: 1, max: 4, type: 'steady', text: 'Hold steady. Resolve the current exchange on its own terms without adding new elements to the fight.' },
                { min: 5, max: 6, type: 'foreshadow', text: 'Foreshadow. Telegraph an incoming danger - an enemy winding up something big, groaning terrain, distant horns - without resolving it yet.' },
                { min: 7, max: 7, type: 'twist', text: 'Battlefield Shift. The environment changes: cover breaks, fire spreads, footing gives way, or visibility drops.' },
                { min: 8, max: 8, type: 'twist', text: 'Enemy Tactic. An opponent changes approach - targets someone vulnerable, reveals a hidden ability, tries to flee, or offers terms.' },
                { min: 9, max: 9, type: 'twist', text: 'Mishap. A weapon, spell, or maneuver goes wrong for someone involved, creating an opening or a complication.' },
                { min: 10, max: 10, type: 'twist', text: 'Reinforcements. New combatants or a third party arrive and change the balance of the fight.' },
            ],
        },
    ];
}

const defaultSettings = Object.freeze({
    enabled: true,
    showHud: true,
    activeDeckId: 'general',
    cooldownTurns: 3,
    tensionEnabled: false,
    tensionMax: 3,
    chainEnabled: true,
    injectionMode: 'depth0', // 'depth0' (Mode A) | 'prefill' (Mode B)
    reasoningTag: '<|channel>thought',
    autoOpenTag: true,
    cooldownDirective: DEFAULT_COOLDOWN_DIRECTIVE,
    payoffDirective: DEFAULT_PAYOFF_DIRECTIVE,
    prefillBackup: null, // { base, applied } while a Mode B prefix is live
});

// Runtime info about the generation currently in flight (never persisted).
const gen = {
    active: false,
    type: null,
    prefillLine: null,      // exact "- Director [...]:" line added in Mode B
    interceptorSeen: false, // prompt assembly was reached for this generation
    groupRound: null,       // { resolved } while a group chat round is running
    laterMember: false,     // this generation is a later character in that round
    watchdog: null,
    token: 0,
};

const HISTORY_LIMIT = 30;
const WATCHDOG_MS = 15000;
let warnedUnparsedReasoning = false;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getCtx() {
    return SillyTavern.getContext();
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function clampInt(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

function escapeHtml(text) {
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function makeId() {
    return `deck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function notify(level, message) {
    if (typeof toastr !== 'undefined' && typeof toastr[level] === 'function') {
        toastr[level](message, 'Scene Director Dice');
    } else {
        console.log(LOG_PREFIX, message);
    }
}

async function askInput(title, defaultValue = '') {
    const ctx = getCtx();
    if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
        const result = await ctx.callGenericPopup(escapeHtml(title), ctx.POPUP_TYPE.INPUT, defaultValue);
        return typeof result === 'string' ? result : null;
    }
    return window.prompt(title, defaultValue);
}

async function askConfirm(message) {
    const ctx = getCtx();
    if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
        const result = await ctx.callGenericPopup(escapeHtml(message), ctx.POPUP_TYPE.CONFIRM);
        const affirmative = ctx.POPUP_RESULT ? ctx.POPUP_RESULT.AFFIRMATIVE : 1;
        return result === affirmative || result === true;
    }
    return window.confirm(message);
}

/* -------------------------------------------------------------------------- */
/* Settings (global) and state (per chat)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normalizes a row IN PLACE. The row objects must keep their identity: the
 * settings are read on almost every action, and replacing the objects here
 * would silently disconnect them from anything still holding a reference.
 */
function normalizeRow(row) {
    row.min = clampInt(row.min, 1, 1000, 1);
    row.max = clampInt(row.max, 1, 1000, row.min);
    row.type = Object.hasOwn(OUTCOME_LABEL, row.type) ? row.type : 'steady';
    row.text = String(row.text ?? '');
    return row;
}

function getSettings() {
    const { extensionSettings } = getCtx();
    if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
        extensionSettings[MODULE_NAME] = {};
    }
    const settings = extensionSettings[MODULE_NAME];

    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(settings, key)) {
            settings[key] = clone(defaultSettings[key]);
        }
    }

    if (!Array.isArray(settings.decks) || settings.decks.length === 0) {
        settings.decks = makeDefaultDecks();
    }
    for (const deck of settings.decks) {
        if (!deck.id) deck.id = makeId();
        deck.name = String(deck.name ?? 'Untitled Deck');
        deck.dieSize = clampInt(deck.dieSize, 2, 1000, 10);
        if (!Array.isArray(deck.rows)) deck.rows = [];
        for (let i = 0; i < deck.rows.length; i++) {
            const row = deck.rows[i];
            if (!row || typeof row !== 'object') deck.rows[i] = {};
            normalizeRow(deck.rows[i]);
        }
    }
    if (!settings.decks.some(d => d.id === settings.activeDeckId)) {
        settings.activeDeckId = settings.decks[0].id;
    }

    settings.cooldownTurns = clampInt(settings.cooldownTurns, 0, 50, 3);
    settings.tensionMax = clampInt(settings.tensionMax, 1, 100, 3);
    if (settings.injectionMode !== 'prefill') settings.injectionMode = 'depth0';
    settings.reasoningTag = String(settings.reasoningTag ?? '');

    return settings;
}

function saveSettings() {
    getCtx().saveSettingsDebounced();
}

function getActiveDeck() {
    const settings = getSettings();
    return settings.decks.find(d => d.id === settings.activeDeckId) ?? settings.decks[0];
}

function defaultState() {
    return {
        cooldownRemaining: 0,
        tensionBonus: 0,
        pendingPayoff: null,
        lastRollData: null,
        currentTurn: null,
        history: [], // earlier turns, newest last, so deleted messages can be rewound
        paused: false,
    };
}

/**
 * Per-chat state. Always re-read from the live context: chatMetadata is a new
 * object after every chat switch, so no long-lived reference is kept.
 */
function getState() {
    const ctx = getCtx();
    const meta = ctx.chatMetadata;
    if (!meta || typeof meta !== 'object') return defaultState();

    if (!meta[META_KEY] || typeof meta[META_KEY] !== 'object') {
        meta[META_KEY] = defaultState();
    }
    const state = meta[META_KEY];
    const defaults = defaultState();
    for (const key of Object.keys(defaults)) {
        if (!Object.hasOwn(state, key)) state[key] = defaults[key];
    }
    state.cooldownRemaining = clampInt(state.cooldownRemaining, 0, 999, 0);
    state.tensionBonus = clampInt(state.tensionBonus, 0, 999, 0);
    state.paused = Boolean(state.paused);
    if (!Array.isArray(state.history)) state.history = [];
    return state;
}

function saveState() {
    const ctx = getCtx();
    if (typeof ctx.saveMetadataDebounced === 'function') {
        ctx.saveMetadataDebounced();
    } else if (typeof ctx.saveMetadata === 'function') {
        ctx.saveMetadata();
    }
}

/* -------------------------------------------------------------------------- */
/* Dice and turn resolution                                                   */
/* -------------------------------------------------------------------------- */

function rollDie(size) {
    return Math.floor(Math.random() * size) + 1;
}

function findRow(deck, total) {
    return deck.rows.find(row => total >= row.min && total <= row.max) ?? null;
}

/** Short fingerprint of a deck's die and table, used to notice edits. */
function deckSignature(deck) {
    const text = JSON.stringify([deck.id, deck.dieSize, deck.rows.map(r => [r.min, r.max, r.type, r.text])]);
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return `${text.length}:${hash >>> 0}`;
}

/**
 * Reads a raw die result against the deck's current table, applies the
 * outcome to the per-chat state, and returns the turn record.
 */
function applyRoll(state, settings, deck, raw) {
    const die = clampInt(deck.dieSize, 2, 1000, 10);
    const bonus = settings.tensionEnabled ? Math.min(state.tensionBonus, settings.tensionMax) : 0;
    const total = Math.min(die, raw + bonus);
    const row = findRow(deck, total);
    const outcome = row ? row.type : 'steady';
    const directive = (row && row.text.trim()) || FALLBACK_STEADY_TEXT;
    let chained = false;

    if (outcome === 'steady') {
        state.tensionBonus = settings.tensionEnabled
            ? Math.min(settings.tensionMax, state.tensionBonus + 1)
            : 0;
    } else if (outcome === 'foreshadow') {
        state.tensionBonus = 0;
        if (settings.chainEnabled) {
            state.pendingPayoff = { directive, total };
            chained = true;
        }
    } else {
        state.tensionBonus = 0;
        state.cooldownRemaining = settings.cooldownTurns;
    }

    state.lastRollData = { die, raw, bonus, total, outcome, deck: deck.name, at: Date.now() };
    return { kind: 'roll', die, raw, bonus, total, outcome, directive, chained, sig: deckSignature(deck) };
}

/** The parts of the per-chat state that a turn can change. */
function snapshotState(state) {
    return {
        cooldownRemaining: state.cooldownRemaining,
        tensionBonus: state.tensionBonus,
        pendingPayoff: clone(state.pendingPayoff) ?? null,
        lastRollData: clone(state.lastRollData) ?? null,
    };
}

/**
 * Puts the state back to how it was before `turn` was resolved. With
 * `keepManual`, cooldown adjustments made by hand since then are kept.
 */
function rewindTurn(state, turn, { keepManual = true } = {}) {
    if (!turn || !turn.pre) return;
    const manualDelta = keepManual
        ? state.cooldownRemaining - (turn.postCooldown ?? state.cooldownRemaining)
        : 0;
    state.cooldownRemaining = Math.max(0, turn.pre.cooldownRemaining + manualDelta);
    state.tensionBonus = turn.pre.tensionBonus;
    state.pendingPayoff = clone(turn.pre.pendingPayoff) ?? null;
    if (Object.hasOwn(turn.pre, 'lastRollData')) {
        state.lastRollData = clone(turn.pre.lastRollData) ?? null;
    }
}

/**
 * Brings the turn record in line with the chat as it is now:
 * - turns whose messages were deleted are undone, newest first, restoring the
 *   cooldown / tension / payoff they had changed;
 * - a turn whose reply was deleted (its user message is still there) becomes
 *   undelivered again, so the next generation reuses its roll.
 * Returns true if anything changed.
 */
function reconcileWithChat(state) {
    const chat = getCtx().chat ?? [];
    let changed = false;

    let turn = state.currentTurn;
    while (turn && turn.delivered && typeof turn.lenAtStart === 'number' && chat.length <= turn.lenAtStart) {
        rewindTurn(state, turn, { keepManual: false });
        turn = state.history.pop() ?? null;
        state.currentTurn = turn;
        changed = true;
    }

    // "Shorter than when the reply was there, and now ending on the user's
    // message" means the reply was deleted, not that a new message arrived.
    if (turn && turn.delivered && typeof turn.lenDelivered === 'number' && chat.length < turn.lenDelivered) {
        const last = chat[chat.length - 1];
        if (!last || last.is_user) {
            turn.delivered = false;
            changed = true;
        }
    }
    return changed;
}

/**
 * If the die or table was edited (or another deck selected) after the cached
 * roll was made, read the same die number against the table as it is now, so
 * a swipe or retry reflects the edit. Rolls again only when the cached number
 * no longer fits on the die. Cooldown and payoff turns have no roll to re-read.
 */
function syncCachedTurn(state, settings) {
    const prev = state.currentTurn;
    if (!prev || prev.kind !== 'roll') return prev;

    const deck = getActiveDeck();
    if (prev.sig === deckSignature(deck)) return prev;

    rewindTurn(state, prev);
    const pre = snapshotState(state);
    const die = clampInt(deck.dieSize, 2, 1000, 10);
    const raw = prev.die === die && prev.raw >= 1 && prev.raw <= die ? prev.raw : rollDie(die);
    const turn = applyRoll(state, settings, deck, raw);
    turn.pre = pre;
    turn.postCooldown = state.cooldownRemaining;
    turn.delivered = Boolean(prev.delivered);
    turn.lenAtStart = prev.lenAtStart ?? null;
    turn.lenDelivered = prev.lenDelivered;
    turn.rerollPending = Boolean(prev.rerollPending);
    state.currentTurn = turn;
    return turn;
}

/**
 * Returns the cached turn for another generation of the same turn (swipe,
 * regenerate, retry, later group member). A turn that was cached while paused
 * is resolved for real once rolling is unpaused.
 */
function reuseTurn(state, settings) {
    const prev = state.currentTurn;
    if (!prev) return resolveNewTurn(state, settings);
    if (prev.kind === 'paused' && !state.paused) {
        const turn = resolveNewTurn(state, settings);
        turn.delivered = Boolean(prev.delivered);
        turn.lenAtStart = prev.lenAtStart ?? null;
        turn.lenDelivered = prev.lenDelivered;
        return turn;
    }
    return syncCachedTurn(state, settings);
}

/**
 * Resolves a brand-new turn and mutates the per-chat state accordingly.
 * Order of precedence: paused > queued payoff > cooldown > die roll.
 * `forceRoll` skips straight to the die (used by the manual reroll).
 */
function resolveNewTurn(state, settings, { forceRoll = false } = {}) {
    const deck = getActiveDeck();
    const pre = snapshotState(state);
    let turn;

    if (state.paused && !forceRoll) {
        turn = { kind: 'paused' };
    } else if (state.pendingPayoff && !forceRoll) {
        const foreshadow = String(state.pendingPayoff.directive ?? '');
        turn = {
            kind: 'payoff',
            directive: String(settings.payoffDirective || DEFAULT_PAYOFF_DIRECTIVE).replace(/\{\{foreshadow\}\}/gi, foreshadow),
        };
        state.pendingPayoff = null;
        state.cooldownRemaining = settings.cooldownTurns;
        state.tensionBonus = 0;
    } else if (state.cooldownRemaining > 0 && !forceRoll) {
        turn = {
            kind: 'cooldown',
            directive: String(settings.cooldownDirective || DEFAULT_COOLDOWN_DIRECTIVE),
        };
        state.cooldownRemaining -= 1;
    } else {
        turn = applyRoll(state, settings, deck, rollDie(clampInt(deck.dieSize, 2, 1000, 10)));
    }

    turn.pre = pre;
    turn.postCooldown = state.cooldownRemaining;
    turn.delivered = false;
    turn.lenAtStart = null;
    state.currentTurn = turn;
    return turn;
}

/**
 * A turn counts as delivered once the chat has grown past the point where its
 * generation started and ends in a non-user message. A failed generation
 * (API error, empty reply) leaves the turn undelivered, so the next attempt
 * reuses it instead of burning another roll or cooldown turn.
 */
function refreshDelivered(state) {
    const turn = state.currentTurn;
    if (!turn || typeof turn.lenAtStart !== 'number') return false;
    const chat = getCtx().chat ?? [];
    const last = chat[chat.length - 1];
    if (!last || last.is_user || chat.length <= turn.lenAtStart) return false;
    if (turn.delivered && turn.lenDelivered === chat.length) return false;
    turn.delivered = true;
    turn.lenDelivered = chat.length; // how long the chat was with this turn's replies in it
    return true;
}

function describeTurn(turn) {
    if (!turn) return 'No turn resolved yet';
    switch (turn.kind) {
        case 'roll': {
            const math = turn.bonus > 0 ? ` (${turn.raw}+${turn.bonus})` : '';
            return `1d${turn.die} = ${turn.total}${math} - ${OUTCOME_LABEL[turn.outcome]}`;
        }
        case 'payoff':
            return 'Payoff turn (no roll)';
        case 'cooldown':
            return 'Cooldown turn (no roll)';
        case 'paused':
            return 'Paused turn (nothing injected)';
        default:
            return 'Unknown';
    }
}

/* -------------------------------------------------------------------------- */
/* Injection                                                                  */
/* -------------------------------------------------------------------------- */

function buildDirectorLabel(turn) {
    switch (turn.kind) {
        case 'roll': {
            const math = turn.bonus > 0 ? ` (${turn.raw}+${turn.bonus})` : '';
            return `1d${turn.die}=${turn.total}${math} - ${OUTCOME_LABEL[turn.outcome]}`;
        }
        case 'payoff':
            return 'Payoff - Trigger Now';
        case 'cooldown':
            return 'Cooldown - Hold Steady';
        default:
            return '';
    }
}

function buildPromptText(turn, settings, { usePrefill = false, isContinue = false, laterMember = false } = {}) {
    const lines = ['[Scene Director - applies to THIS reply only]'];

    if (turn.kind === 'roll') {
        const math = turn.bonus > 0 ? ` (rolled ${turn.raw} + ${turn.bonus} tension)` : '';
        lines.push(`Die roll: 1d${turn.die} = ${turn.total}${math}. Outcome: ${OUTCOME_LABEL[turn.outcome].toUpperCase()}.`);
        lines.push(`Directive: ${turn.directive}`);
        if (turn.outcome === 'foreshadow') {
            lines.push('Plant only a subtle sensory cue or warning sign this turn. Do NOT trigger or resolve the hinted event yet.');
        } else if (turn.outcome === 'twist') {
            lines.push('Weave this development into the scene now, as an organic consequence of what is happening, if logical for the setting.');
        }
    } else if (turn.kind === 'payoff') {
        lines.push('No roll this turn. Outcome: PAYOFF.');
        lines.push(`Directive: ${turn.directive}`);
    } else if (turn.kind === 'cooldown') {
        lines.push('No roll this turn. Outcome: COOLDOWN ACTIVE / HOLD STEADY.');
        lines.push(`Directive: ${turn.directive}`);
    }

    const isDevelopment = turn.kind === 'payoff' || (turn.kind === 'roll' && turn.outcome !== 'steady');
    if (laterMember && isDevelopment) {
        lines.push('Other characters have already replied in this round under this same directive. If one of them has already carried it out, build on what they did instead of introducing another development.');
    }

    const tag = settings.reasoningTag.trim();
    const where = tag ? `inside your ${tag} reasoning block` : 'in your reasoning';
    if (isContinue) {
        // The reply is already mid-prose: no reasoning line, and no doing it twice.
        lines.push('This generation continues a reply that is already in progress. If the text so far has already carried out this directive, do not repeat it; otherwise keep following it. Do not write a "- Director:" line or any note about the directive. Just continue the prose.');
    } else if (usePrefill) {
        lines.push(`Your reasoning already opens with a "- Director [...]:" line. Complete that line by evaluating how this directive applies to the current scene, continue reasoning as usual, then write the reply accordingly.`);
    } else {
        lines.push(`Before writing any prose, ${where}, write one line beginning with "- Director:" that evaluates how this directive applies to the current scene. Then write the reply accordingly.`);
    }
    lines.push('Never mention the die, the roll, or the Director in the visible reply.');

    return lines.join('\n');
}

/**
 * Mode B: SillyTavern stores the reply prefix as part of the reply. If the
 * reasoning block was not split off into hidden reasoning, the Director line
 * (with the roll and outcome) would stay in the message and be sent back to the
 * model on later turns. Strip the roll label from whatever stays in context.
 */
function scrubDirectorLine() {
    const line = gen.prefillLine;
    if (!line) return;

    const ctx = getCtx();
    const chat = ctx.chat ?? [];
    const id = chat.length - 1;
    const message = chat[id];
    if (!message || message.is_user) return;

    const neutral = '- Director:';
    const strip = text => text.split(line).join(neutral);
    let changed = false;
    let leftInText = false;

    if (typeof message.mes === 'string' && message.mes.includes(line)) {
        message.mes = strip(message.mes);
        changed = true;
        leftInText = true;
    }
    if (Array.isArray(message.swipes) && typeof message.swipe_id === 'number') {
        const swipe = message.swipes[message.swipe_id];
        if (typeof swipe === 'string' && swipe.includes(line)) {
            message.swipes[message.swipe_id] = strip(swipe);
            changed = true;
        }
    }
    // Hidden reasoning keeps the label for the user to read, unless reasoning
    // is itself sent back to the model.
    if (ctx.powerUserSettings?.reasoning?.add_to_prompts
        && typeof message.extra?.reasoning === 'string'
        && message.extra.reasoning.includes(line)) {
        message.extra.reasoning = strip(message.extra.reasoning);
        changed = true;
    }
    if (!changed) return;

    // Already on screen (streaming, swipe): redraw and save the corrected text.
    try {
        if (typeof document !== 'undefined' && document.querySelector?.(`#chat .mes[mesid="${id}"]`)) {
            if (typeof ctx.updateMessageBlock === 'function') ctx.updateMessageBlock(id, message);
            if (typeof ctx.saveChat === 'function') ctx.saveChat();
        }
    } catch (error) {
        console.warn(LOG_PREFIX, 'Could not refresh the message after removing the Director label', error);
    }

    if (leftInText && !warnedUnparsedReasoning) {
        warnedUnparsedReasoning = true;
        notify('warning', 'Mode B: the reasoning block was not separated from the reply, so it stayed in the message (the roll label was removed). Turn on Reasoning auto-parse with a prefix and suffix that match your model, or use Mode A.');
    }
}

function clearPrompt() {
    try {
        getCtx().setExtensionPrompt(PROMPT_KEY, '', EXT_PROMPT_IN_CHAT, 0, false, EXT_ROLE_SYSTEM);
    } catch (error) {
        console.warn(LOG_PREFIX, 'Failed to clear extension prompt', error);
    }
}

/** Puts the user's own "Start Reply With" prefix back after a Mode B generation. */
function restorePrefill() {
    const settings = getSettings();
    const backup = settings.prefillBackup;
    if (!backup) return;

    const powerUser = getCtx().powerUserSettings;
    // Only restore if the value is still the one we wrote; otherwise the user
    // edited the field mid-generation and their edit wins.
    if (powerUser && powerUser.user_prompt_bias === backup.applied) {
        powerUser.user_prompt_bias = backup.base;
    }
    settings.prefillBackup = null;
    saveSettings();
}

function cleanupInjection() {
    clearPrompt();
    restorePrefill();
}

function shouldUsePrefill(settings, type) {
    return settings.injectionMode === 'prefill'
        && type !== 'continue'
        && Boolean(getCtx().powerUserSettings);
}

/** Mode B: temporarily extends "Start Reply With" with the Director line. */
function applyPrefill(turn, settings) {
    const label = buildDirectorLabel(turn);
    if (!label) return;

    const powerUser = getCtx().powerUserSettings;
    const base = String(powerUser.user_prompt_bias ?? '');
    // No trailing space: a prompt that ends in whitespace tokenizes badly on
    // most text-completion backends. The model supplies the space itself.
    const line = `- Director [${label}]:`;
    const tag = settings.reasoningTag.trim();

    // The user's own prefix is always kept and comes first.
    const trimmed = base.replace(/[ \t]+$/, '');
    const lead = trimmed.trim() ? `${trimmed}${trimmed.endsWith('\n') ? '' : '\n'}` : '';
    const opener = tag && settings.autoOpenTag && !base.includes(tag) ? `${tag}\n` : '';
    const applied = `${lead}${opener}${line}`;

    settings.prefillBackup = { base, applied };
    powerUser.user_prompt_bias = applied;
    gen.prefillLine = line;
}

function applyPrompt(turn, settings, type) {
    const text = buildPromptText(turn, settings, {
        usePrefill: shouldUsePrefill(settings, type),
        isContinue: type === 'continue',
        laterMember: gen.laterMember,
    });
    getCtx().setExtensionPrompt(PROMPT_KEY, text, EXT_PROMPT_IN_CHAT, 0, false, EXT_ROLE_SYSTEM);
}

/* -------------------------------------------------------------------------- */
/* Generation lifecycle                                                       */
/* -------------------------------------------------------------------------- */

function classifyType(type) {
    const t = String(type || 'normal').toLowerCase();
    if (t === 'quiet' || t === 'impersonate') return 'ignore';
    if (['swipe', 'regenerate', 'continue', 'append', 'appendfinal'].includes(t)) return 'retry';
    return 'normal';
}

function isInjectable(turn, state) {
    return Boolean(turn) && turn.kind !== 'paused' && !state.paused;
}

function stopWatchdog() {
    if (gen.watchdog) clearTimeout(gen.watchdog);
    gen.watchdog = null;
}

/**
 * SillyTavern only announces the end of a generation that got as far as showing
 * the stop button. If it bailed out before that (server unreachable, for
 * example), nothing tells us, so check once and clean up after ourselves.
 */
function startWatchdog() {
    stopWatchdog();
    const token = ++gen.token;
    gen.watchdog = setTimeout(() => {
        gen.watchdog = null;
        if (!gen.active || gen.token !== token || gen.interceptorSeen) return;
        const stopButton = typeof document !== 'undefined' ? document.getElementById('mes_stop') : null;
        if (!stopButton || typeof getComputedStyle !== 'function') return;
        if (getComputedStyle(stopButton).display === 'none') finishGeneration();
    }, WATCHDOG_MS);
    if (typeof gen.watchdog?.unref === 'function') gen.watchdog.unref();
}

/** A tool call makes SillyTavern generate again within the same reply. */
function isToolFollowUp(chat) {
    const last = chat[chat.length - 1];
    return Boolean(last && last.is_system && Array.isArray(last.extra?.tool_invocations));
}

/**
 * Runs once at the start of every real generation (GENERATION_AFTER_COMMANDS),
 * which is early enough for the reasoning prefill to be picked up.
 */
function prepareGeneration(rawType) {
    const kind = classifyType(rawType);
    if (kind === 'ignore') return; // quiet / impersonate: no roll, no cooldown change

    cleanupInjection(); // drop anything stale from an interrupted generation
    stopWatchdog();
    gen.active = false;
    gen.type = null;
    gen.prefillLine = null;
    gen.interceptorSeen = false;
    gen.laterMember = false;

    const settings = getSettings();
    if (!settings.enabled) return;

    const ctx = getCtx();
    const chat = ctx.chat ?? [];
    const state = getState();
    const type = String(rawType || 'normal').toLowerCase();

    reconcileWithChat(state);
    let turn = state.currentTurn;

    // Still the same turn: another character in the same group round, or the
    // follow-up generation after a tool call.
    const laterMember = Boolean(gen.groupRound && gen.groupRound.resolved);
    const sameRound = kind === 'normal' && Boolean(turn) && (laterMember || isToolFollowUp(chat));

    if (kind === 'retry' || sameRound) {
        // Reuse the cached roll. It is only re-read if the table was edited since.
        turn = reuseTurn(state, settings);
        gen.laterMember = sameRound && laterMember;
    } else {
        refreshDelivered(state);
        turn = state.currentTurn;
        if (!turn) {
            turn = resolveNewTurn(state, settings);
        } else if (turn.delivered && turn.rerollPending) {
            // Rerolled but never swiped: the reroll becomes this new turn's result.
            turn = reuseTurn(state, settings);
            turn.delivered = false;
        } else if (turn.delivered) {
            state.history.push(turn);
            if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
            turn = resolveNewTurn(state, settings);
        } else {
            turn = reuseTurn(state, settings); // retry of a failed generation
        }
        // Anchor the turn at its user message (or where the reply will go).
        const last = chat[chat.length - 1];
        turn.lenAtStart = chat.length - (last && last.is_user ? 1 : 0);
        if (gen.groupRound) gen.groupRound.resolved = true;
    }
    turn.rerollPending = false;

    gen.active = true;
    gen.type = type;
    saveState();

    if (isInjectable(turn, state)) {
        if (shouldUsePrefill(settings, type)) applyPrefill(turn, settings);
        applyPrompt(turn, settings, type);
    }
    startWatchdog();
    updateUi();
}

function onGenerationAfterCommands(type, _options, dryRun) {
    if (dryRun) return;
    try {
        prepareGeneration(type);
    } catch (error) {
        console.error(LOG_PREFIX, 'Failed to prepare generation', error);
    }
}

/**
 * generate_interceptor (see manifest.json). Runs right before prompt assembly.
 * Re-asserts the depth-0 directive, and resolves the turn itself on SillyTavern
 * builds where GENERATION_AFTER_COMMANDS did not fire.
 */
globalThis.sceneDirectorDiceInterceptor = async function (_chat, _contextSize, _abort, type) {
    try {
        if (classifyType(type) === 'ignore') return;
        if (!gen.active) prepareGeneration(type);
        gen.interceptorSeen = true;
        if (!gen.active) return;
        const settings = getSettings();
        const state = getState();
        if (settings.enabled && isInjectable(state.currentTurn, state)) {
            applyPrompt(state.currentTurn, settings, gen.type);
        }
    } catch (error) {
        console.error(LOG_PREFIX, 'Interceptor failed', error);
    }
};

function finishGeneration() {
    stopWatchdog();
    try {
        scrubDirectorLine();
        const state = getState();
        if (refreshDelivered(state)) saveState();
        cleanupInjection();
    } catch (error) {
        console.error(LOG_PREFIX, 'Failed to finish generation', error);
    }
    gen.active = false;
    gen.type = null;
    gen.prefillLine = null;
    gen.laterMember = false;
    updateUi();
}

function onChatChanged() {
    stopWatchdog();
    cleanupInjection();
    gen.active = false;
    gen.type = null;
    gen.prefillLine = null;
    gen.laterMember = false;
    gen.groupRound = null;
    // A branch or checkpoint can open with fewer messages than the state covers.
    if (reconcileWithChat(getState())) saveState();
    updateUi();
}

function onMessageDeleted() {
    // Regenerate deletes the old reply mid-generation; that is not a rewind.
    if (gen.active) return;
    if (reconcileWithChat(getState())) saveState();
    updateUi();
}

/* -------------------------------------------------------------------------- */
/* User actions                                                               */
/* -------------------------------------------------------------------------- */

async function rerollCurrentTurn() {
    const settings = getSettings();
    const state = getState();

    if (!settings.enabled) {
        notify('warning', 'The extension is disabled.');
        return;
    }
    if (state.paused) {
        notify('info', 'Rolling is paused. Unpause to reroll.');
        return;
    }

    const prev = state.currentTurn;
    let forceRoll = false;

    if (prev && (prev.kind === 'cooldown' || prev.kind === 'payoff')) {
        const isCooldown = prev.kind === 'cooldown';
        const ok = await askConfirm(
            `The current turn is a ${isCooldown ? 'cooldown' : 'payoff'} turn, so it has no die result to reroll. ` +
            `Force a fresh die roll instead? This discards the ${isCooldown ? 'remaining cooldown' : 'queued payoff'}.`,
        );
        if (!ok) return;
        forceRoll = true;
    }

    // Undo what the cached turn did before resolving it again.
    rewindTurn(state, prev);

    if (forceRoll) {
        state.cooldownRemaining = 0;
        state.pendingPayoff = null;
    } else if (prev && prev.kind === 'roll') {
        forceRoll = true;
    }

    const turn = resolveNewTurn(state, settings, { forceRoll });
    // The new result replaces the cached one for the same turn slot. If that
    // turn was already answered, the result waits for the next generation:
    // a swipe redoes the reply with it, a new message takes it as its own.
    turn.delivered = prev ? Boolean(prev.delivered) : false;
    turn.lenAtStart = prev ? (prev.lenAtStart ?? null) : null;
    turn.lenDelivered = prev ? prev.lenDelivered : undefined;
    turn.rerollPending = turn.delivered;

    saveState();
    updateUi();
    notify('info', `${describeTurn(turn)}. Used by your next swipe or message.`);
}

function togglePause() {
    const state = getState();
    state.paused = !state.paused;
    saveState();
    updateUi();
}

function adjustCooldown(delta, clearAll = false) {
    const state = getState();
    if (clearAll) {
        state.cooldownRemaining = 0;
        state.pendingPayoff = null;
    } else {
        state.cooldownRemaining = clampInt(state.cooldownRemaining + delta, 0, 99, 0);
    }
    saveState();
    updateUi();
}

async function resetChatState() {
    const ok = await askConfirm('Reset Scene Director Dice state (cooldown, tension, queued payoff, cached roll) for this chat?');
    if (!ok) return;
    const ctx = getCtx();
    if (ctx.chatMetadata) ctx.chatMetadata[META_KEY] = defaultState();
    saveState();
    updateUi();
}

/* -------------------------------------------------------------------------- */
/* HUD                                                                        */
/* -------------------------------------------------------------------------- */

function buildHud() {
    if (document.getElementById('sdd-hud')) return;
    const sendForm = document.getElementById('send_form');
    if (!sendForm) return;

    const hud = document.createElement('div');
    hud.id = 'sdd-hud';
    hud.className = 'sdd-hud';
    hud.innerHTML = `
        <div class="sdd-pill" id="sdd-pill" data-state="ready">
            <span class="sdd-hud-status" id="sdd-hud-status"></span>
            <span class="sdd-hud-last" id="sdd-hud-last"></span>
            <span class="sdd-hud-actions">
                <button type="button" class="sdd-hud-btn" id="sdd-hud-pause" title="Pause / resume rolling"><i class="fa-solid fa-lock-open"></i></button>
                <button type="button" class="sdd-hud-btn" id="sdd-hud-reroll" title="Reroll the current turn (do this before swiping)"><i class="fa-solid fa-dice"></i></button>
                <button type="button" class="sdd-hud-btn" id="sdd-hud-cd-minus" title="Cooldown -1 (Shift+click: clear cooldown and queued payoff)"><i class="fa-solid fa-minus"></i></button>
                <button type="button" class="sdd-hud-btn" id="sdd-hud-cd-plus" title="Cooldown +1"><i class="fa-solid fa-plus"></i></button>
            </span>
        </div>`;
    sendForm.insertAdjacentElement('beforebegin', hud);

    hud.querySelector('#sdd-hud-pause').addEventListener('click', togglePause);
    hud.querySelector('#sdd-hud-reroll').addEventListener('click', () => rerollCurrentTurn());
    hud.querySelector('#sdd-hud-cd-minus').addEventListener('click', event => adjustCooldown(-1, event.shiftKey));
    hud.querySelector('#sdd-hud-cd-plus').addEventListener('click', () => adjustCooldown(1));
}

function updateHud() {
    if (typeof document === 'undefined') return;
    const hud = document.getElementById('sdd-hud');
    if (!hud) return;

    const settings = getSettings();
    const state = getState();
    const deck = getActiveDeck();

    hud.style.display = settings.enabled && settings.showHud ? '' : 'none';

    let status;
    let stateName;
    if (state.paused) {
        status = '\u23F8\uFE0F Paused';
        stateName = 'paused';
    } else if (state.pendingPayoff) {
        status = '\u26A1 Payoff Primed';
        stateName = 'payoff';
    } else if (state.cooldownRemaining > 0) {
        status = `\u2744\uFE0F Cooldown: ${state.cooldownRemaining} turn${state.cooldownRemaining === 1 ? '' : 's'}`;
        stateName = 'cooldown';
    } else {
        status = `\uD83C\uDFB2 Ready (1d${deck.dieSize})`;
        stateName = 'ready';
    }
    if (settings.tensionEnabled && state.tensionBonus > 0) {
        status += ` + Tension: +${state.tensionBonus}`;
    }

    const pill = document.getElementById('sdd-pill');
    const statusEl = document.getElementById('sdd-hud-status');
    const lastEl = document.getElementById('sdd-hud-last');
    const pauseBtn = document.getElementById('sdd-hud-pause');

    pill.dataset.state = stateName;
    statusEl.textContent = status;
    statusEl.title = `Deck: ${deck.name}\nCurrent turn: ${describeTurn(state.currentTurn)}`;

    const last = state.lastRollData;
    if (last) {
        lastEl.textContent = `Last: ${last.total} \u00B7 ${OUTCOME_LABEL[last.outcome] ?? last.outcome}`;
        const math = last.bonus > 0 ? `${last.raw} + ${last.bonus} tension` : `${last.raw}`;
        lastEl.title = `Rolled ${math} on 1d${last.die} (${last.deck})`;
        lastEl.dataset.outcome = last.outcome;
    } else {
        lastEl.textContent = 'Last: \u2014';
        lastEl.title = 'No roll in this chat yet';
        lastEl.dataset.outcome = '';
    }

    pauseBtn.classList.toggle('sdd-active', state.paused);
    pauseBtn.innerHTML = `<i class="fa-solid ${state.paused ? 'fa-lock' : 'fa-lock-open'}"></i>`;
    pauseBtn.title = state.paused ? 'Rolling is paused - click to resume' : 'Pause rolling for this scene';
}

/* -------------------------------------------------------------------------- */
/* Settings drawer                                                            */
/* -------------------------------------------------------------------------- */

const SETTINGS_HTML = `
<div id="sdd-settings" class="sdd-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Scene Director Dice</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label" for="sdd-enabled">
                <input type="checkbox" id="sdd-enabled">
                <span>Enable Scene Director Dice</span>
            </label>
            <label class="checkbox_label" for="sdd-show-hud">
                <input type="checkbox" id="sdd-show-hud">
                <span>Show HUD bar above the message input</span>
            </label>

            <h4 class="sdd-heading">Deck</h4>
            <div class="sdd-flex">
                <select id="sdd-deck" class="text_pole sdd-grow"></select>
                <div id="sdd-deck-add" class="menu_button fa-solid fa-plus" title="Add deck"></div>
                <div id="sdd-deck-rename" class="menu_button fa-solid fa-pen" title="Rename deck"></div>
                <div id="sdd-deck-delete" class="menu_button fa-solid fa-trash" title="Delete deck"></div>
            </div>
            <div class="sdd-grid">
                <label for="sdd-die">Die size (1dX, this deck)
                    <input type="number" id="sdd-die" class="text_pole" min="2" max="1000" step="1">
                </label>
                <label for="sdd-cooldown">Cooldown turns
                    <input type="number" id="sdd-cooldown" class="text_pole" min="0" max="50" step="1">
                </label>
            </div>

            <div class="sdd-table-head">
                <span>Range</span><span>Outcome</span><span>Directive</span>
            </div>
            <div id="sdd-rows" class="sdd-rows"></div>
            <div id="sdd-table-warning" class="sdd-warning"></div>
            <div class="sdd-flex">
                <div id="sdd-row-add" class="menu_button menu_button_icon"><i class="fa-solid fa-plus"></i><span>Add row</span></div>
                <div id="sdd-deck-reset" class="menu_button menu_button_icon"><i class="fa-solid fa-rotate-left"></i><span>Reset table to default</span></div>
            </div>

            <h4 class="sdd-heading">Pacing</h4>
            <label class="checkbox_label" for="sdd-chain">
                <input type="checkbox" id="sdd-chain">
                <span>Link Foreshadow Rolls to Next-Turn Payoff</span>
            </label>
            <label class="checkbox_label" for="sdd-tension">
                <input type="checkbox" id="sdd-tension">
                <span>Enable Tension Bonus (+1 per Steady turn)</span>
            </label>
            <div class="sdd-grid">
                <label for="sdd-tension-max">Tension bonus cap
                    <input type="number" id="sdd-tension-max" class="text_pole" min="1" max="100" step="1">
                </label>
            </div>

            <h4 class="sdd-heading">Injection</h4>
            <label for="sdd-mode">Injection mode</label>
            <select id="sdd-mode" class="text_pole">
                <option value="depth0">Mode A: Depth-0 prompt + reasoning instruction</option>
                <option value="prefill">Mode B: Reasoning prefill (Start Reply With) + depth-0 directive</option>
            </select>
            <label for="sdd-tag">Reasoning tag format</label>
            <input type="text" id="sdd-tag" class="text_pole" list="sdd-tag-options" placeholder="&lt;|channel&gt;thought">
            <datalist id="sdd-tag-options">
                <option value="&lt;|channel&gt;thought"></option>
                <option value="&lt;think&gt;"></option>
            </datalist>
            <label class="checkbox_label" for="sdd-auto-open">
                <input type="checkbox" id="sdd-auto-open">
                <span>Mode B: open the reasoning tag (after your own Start Reply With text) if that text does not already contain it</span>
            </label>
            <small class="sdd-hint">Mode B temporarily extends Start Reply With for one generation and restores it afterwards. It needs a backend that honors a reply prefill, and SillyTavern's Reasoning auto-parse set to your model's tags so the reasoning is split off from the reply; use Mode A otherwise.</small>

            <h4 class="sdd-heading">Directive wording</h4>
            <label for="sdd-cooldown-text">Cooldown / hold-steady directive</label>
            <textarea id="sdd-cooldown-text" class="text_pole" rows="3"></textarea>
            <label for="sdd-payoff-text">Payoff directive (<code>{{foreshadow}}</code> = the foreshadow row that was rolled)</label>
            <textarea id="sdd-payoff-text" class="text_pole" rows="3"></textarea>

            <h4 class="sdd-heading">Current chat</h4>
            <div id="sdd-readout" class="sdd-readout"></div>
            <div class="sdd-flex">
                <div id="sdd-reroll" class="menu_button menu_button_icon"><i class="fa-solid fa-dice"></i><span>Reroll Current Turn</span></div>
                <div id="sdd-reset-state" class="menu_button menu_button_icon"><i class="fa-solid fa-eraser"></i><span>Reset chat state</span></div>
            </div>
        </div>
    </div>
</div>`;

/**
 * Number fields commit when the user leaves the field or presses Enter, not on
 * every keystroke, so half-typed or cleared values are never saved. The field
 * is then rewritten with the value actually stored.
 */
function bindNumberInput($input, min, max, getValue, setValue) {
    $input.on('change', () => {
        const raw = String($input.val() ?? '').trim();
        if (raw !== '' && Number.isFinite(Number(raw))) {
            setValue(clampInt(raw, min, max, getValue()));
        }
        $input.val(getValue());
    });
}

function formatRanges(numbers) {
    const parts = [];
    let start = null;
    let prev = null;
    for (const n of numbers) {
        if (start === null) {
            start = n;
        } else if (n !== prev + 1) {
            parts.push(start === prev ? `${start}` : `${start}-${prev}`);
            start = n;
        }
        prev = n;
    }
    if (start !== null) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    return parts.join(', ');
}

function validateDeck(deck) {
    const problems = [];
    const hits = new Array(deck.dieSize + 1).fill(0);

    deck.rows.forEach((row, index) => {
        if (row.min > row.max) problems.push(`Row ${index + 1}: min is greater than max.`);
        if (row.max > deck.dieSize) problems.push(`Row ${index + 1}: range goes past 1d${deck.dieSize}.`);
        for (let n = Math.max(1, row.min); n <= Math.min(deck.dieSize, row.max); n++) hits[n]++;
    });

    const uncovered = [];
    const overlapping = [];
    for (let n = 1; n <= deck.dieSize; n++) {
        if (hits[n] === 0) uncovered.push(n);
        if (hits[n] > 1) overlapping.push(n);
    }
    if (uncovered.length) problems.push(`No row covers: ${formatRanges(uncovered)} (treated as Steady).`);
    if (overlapping.length) problems.push(`Overlapping rows at: ${formatRanges(overlapping)} (first matching row wins).`);
    return problems;
}

function renderWarning() {
    const problems = validateDeck(getActiveDeck());
    const $warning = $('#sdd-table-warning');
    $warning.empty().toggle(problems.length > 0);
    for (const problem of problems) {
        $warning.append($('<div></div>').text(problem));
    }
}

function renderRows() {
    const deck = getActiveDeck();
    const $rows = $('#sdd-rows').empty();

    deck.rows.forEach((row, index) => {
        // Always resolve the row from the live settings at edit time.
        const liveRow = () => getActiveDeck().rows[index];
        const $row = $('<div class="sdd-table-row"></div>').attr('data-type', row.type);

        const $min = $('<input type="number" class="text_pole sdd-num" min="1" step="1" title="Range minimum">').val(row.min);
        const $max = $('<input type="number" class="text_pole sdd-num" min="1" step="1" title="Range maximum">').val(row.max);
        const $type = $('<select class="text_pole sdd-type" title="Outcome type"></select>');
        for (const key of Object.keys(OUTCOME_OPTION_LABEL)) {
            $type.append($('<option></option>').val(key).text(OUTCOME_OPTION_LABEL[key]));
        }
        $type.val(row.type);
        const $text = $('<textarea class="text_pole sdd-text" rows="2" placeholder="Directive for the narrator"></textarea>').val(row.text);
        const $del = $('<div class="menu_button fa-solid fa-xmark sdd-del" title="Delete row"></div>');

        bindNumberInput($min, 1, 1000, () => liveRow()?.min ?? row.min, value => {
            const target = liveRow();
            if (!target) return;
            target.min = value;
            saveSettings();
            renderWarning();
        });
        bindNumberInput($max, 1, 1000, () => liveRow()?.max ?? row.max, value => {
            const target = liveRow();
            if (!target) return;
            target.max = value;
            saveSettings();
            renderWarning();
        });
        $type.on('change', () => {
            const target = liveRow();
            if (!target) return;
            target.type = Object.hasOwn(OUTCOME_LABEL, String($type.val())) ? String($type.val()) : 'steady';
            $row.attr('data-type', target.type);
            saveSettings();
        });
        $text.on('input', () => {
            const target = liveRow();
            if (!target) return;
            target.text = String($text.val());
            saveSettings();
        });
        $del.on('click', () => {
            getActiveDeck().rows.splice(index, 1);
            saveSettings();
            renderRows();
        });

        const $range = $('<div class="sdd-range"></div>').append($min, $('<span>-</span>'), $max);
        $row.append($range, $type, $del, $text);
        $rows.append($row);
    });

    renderWarning();
}

function renderDeckSelect() {
    const settings = getSettings();
    const $select = $('#sdd-deck').empty();
    for (const deck of settings.decks) {
        $select.append($('<option></option>').val(deck.id).text(`${deck.name} (1d${deck.dieSize})`));
    }
    $select.val(settings.activeDeckId);
}

function renderDeck() {
    renderDeckSelect();
    $('#sdd-die').val(getActiveDeck().dieSize);
    renderRows();
}

function updateReadout() {
    if (typeof document === 'undefined') return;
    const readout = document.getElementById('sdd-readout');
    if (!readout) return;
    const state = getState();
    const parts = [
        `Cooldown: ${state.cooldownRemaining}`,
        `Tension: +${state.tensionBonus}`,
        `Payoff queued: ${state.pendingPayoff ? 'yes' : 'no'}`,
        `Paused: ${state.paused ? 'yes' : 'no'}`,
        `Cached turn: ${describeTurn(state.currentTurn)}`,
    ];
    readout.textContent = parts.join('  |  ');
}

function updateUi() {
    updateHud();
    updateReadout();
}

function buildSettingsUi() {
    if (document.getElementById('sdd-settings')) return;
    const $container = $('#extensions_settings2').length ? $('#extensions_settings2') : $('#extensions_settings');
    $container.append(SETTINGS_HTML);

    const settings = getSettings();

    $('#sdd-enabled').prop('checked', settings.enabled).on('change', function () {
        getSettings().enabled = Boolean($(this).prop('checked'));
        if (!getSettings().enabled) cleanupInjection();
        saveSettings();
        updateUi();
    });
    $('#sdd-show-hud').prop('checked', settings.showHud).on('change', function () {
        getSettings().showHud = Boolean($(this).prop('checked'));
        saveSettings();
        updateUi();
    });

    $('#sdd-deck').on('change', function () {
        getSettings().activeDeckId = String($(this).val());
        saveSettings();
        renderDeck();
        updateUi();
    });
    $('#sdd-deck-add').on('click', async () => {
        const name = await askInput('Name for the new deck:', 'New Deck');
        if (!name || !name.trim()) return;
        const s = getSettings();
        const deck = { id: makeId(), name: name.trim(), dieSize: 10, rows: makeDefaultGeneralRows() };
        s.decks.push(deck);
        s.activeDeckId = deck.id;
        saveSettings();
        renderDeck();
        updateUi();
    });
    $('#sdd-deck-rename').on('click', async () => {
        const deck = getActiveDeck();
        const name = await askInput('Rename deck:', deck.name);
        if (!name || !name.trim()) return;
        deck.name = name.trim();
        saveSettings();
        renderDeckSelect();
        updateUi();
    });
    $('#sdd-deck-delete').on('click', async () => {
        const s = getSettings();
        if (s.decks.length <= 1) {
            notify('warning', 'You need at least one deck.');
            return;
        }
        const deck = getActiveDeck();
        if (!await askConfirm(`Delete the deck "${deck.name}"?`)) return;
        s.decks = s.decks.filter(d => d.id !== deck.id);
        s.activeDeckId = s.decks[0].id;
        saveSettings();
        renderDeck();
        updateUi();
    });

    bindNumberInput($('#sdd-die'), 2, 1000, () => getActiveDeck().dieSize, value => {
        getActiveDeck().dieSize = value;
        saveSettings();
        renderDeckSelect();
        renderWarning();
        updateUi();
    });
    bindNumberInput($('#sdd-cooldown').val(settings.cooldownTurns), 0, 50, () => getSettings().cooldownTurns, value => {
        getSettings().cooldownTurns = value;
        saveSettings();
    });

    $('#sdd-row-add').on('click', () => {
        const deck = getActiveDeck();
        const highest = deck.rows.reduce((acc, row) => Math.max(acc, row.max), 0);
        const next = Math.min(deck.dieSize, highest + 1);
        deck.rows.push({ min: next, max: next, type: 'twist', text: '' });
        saveSettings();
        renderRows();
    });
    $('#sdd-deck-reset').on('click', async () => {
        const deck = getActiveDeck();
        if (!await askConfirm(`Replace the table of "${deck.name}" with the default 1d10 table?`)) return;
        deck.dieSize = 10;
        deck.rows = makeDefaultGeneralRows();
        saveSettings();
        renderDeck();
        updateUi();
    });

    $('#sdd-chain').prop('checked', settings.chainEnabled).on('change', function () {
        getSettings().chainEnabled = Boolean($(this).prop('checked'));
        saveSettings();
    });
    $('#sdd-tension').prop('checked', settings.tensionEnabled).on('change', function () {
        getSettings().tensionEnabled = Boolean($(this).prop('checked'));
        saveSettings();
        updateUi();
    });
    bindNumberInput($('#sdd-tension-max').val(settings.tensionMax), 1, 100, () => getSettings().tensionMax, value => {
        getSettings().tensionMax = value;
        saveSettings();
        updateUi();
    });

    $('#sdd-mode').val(settings.injectionMode).on('change', function () {
        getSettings().injectionMode = $(this).val() === 'prefill' ? 'prefill' : 'depth0';
        saveSettings();
    });
    $('#sdd-tag').val(settings.reasoningTag).on('input', function () {
        getSettings().reasoningTag = String($(this).val());
        saveSettings();
    });
    $('#sdd-auto-open').prop('checked', settings.autoOpenTag).on('change', function () {
        getSettings().autoOpenTag = Boolean($(this).prop('checked'));
        saveSettings();
    });

    $('#sdd-cooldown-text').val(settings.cooldownDirective).on('input', function () {
        getSettings().cooldownDirective = String($(this).val());
        saveSettings();
    });
    $('#sdd-payoff-text').val(settings.payoffDirective).on('input', function () {
        getSettings().payoffDirective = String($(this).val());
        saveSettings();
    });

    $('#sdd-reroll').on('click', () => rerollCurrentTurn());
    $('#sdd-reset-state').on('click', () => resetChatState());

    renderDeck();
}

/* -------------------------------------------------------------------------- */
/* Init                                                                       */
/* -------------------------------------------------------------------------- */

// Small console / scripting surface.
globalThis.SceneDirectorDice = {
    getState,
    getSettings,
    reroll: rerollCurrentTurn,
    togglePause,
    adjustCooldown,
    prepareGeneration,
    finishGeneration,
    onMessageDeleted,
    setGroupRound(active) { gen.groupRound = active ? { resolved: false } : null; },
};

jQuery(async () => {
    const ctx = getCtx();
    const eventSource = ctx.eventSource;
    const eventTypes = ctx.eventTypes ?? ctx.event_types;

    getSettings();
    // If the page was closed mid-generation in Mode B, put the user's prefix back.
    restorePrefill();

    buildSettingsUi();
    buildHud();

    eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
    if (eventTypes.GENERATION_AFTER_COMMANDS) {
        eventSource.on(eventTypes.GENERATION_AFTER_COMMANDS, onGenerationAfterCommands);
    }
    eventSource.on(eventTypes.GENERATION_ENDED, finishGeneration);
    eventSource.on(eventTypes.GENERATION_STOPPED, finishGeneration);
    eventSource.on(eventTypes.MESSAGE_RECEIVED, () => {
        if (gen.active) finishGeneration();
    });
    if (eventTypes.MESSAGE_DELETED) {
        eventSource.on(eventTypes.MESSAGE_DELETED, onMessageDeleted);
    }
    // In a group chat every character generates separately; the whole round is one turn.
    if (eventTypes.GROUP_WRAPPER_STARTED && eventTypes.GROUP_WRAPPER_FINISHED) {
        eventSource.on(eventTypes.GROUP_WRAPPER_STARTED, () => { gen.groupRound = { resolved: false }; });
        eventSource.on(eventTypes.GROUP_WRAPPER_FINISHED, () => { gen.groupRound = null; });
    }

    onChatChanged();
    console.log(LOG_PREFIX, 'loaded');
});
