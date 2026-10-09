// Daily Routine & Random Events - SillyTavern extension
// Injects a hidden time-aware note before each generation:
//  1) what the character is doing right now (routine, based on your real clock)
//  2) occasionally a random, time-appropriate event

(() => {
    const MODULE = 'daily_routine';
    const PROMPT_KEY = 'daily_routine_prompt';

    // setExtensionPrompt constants
    const POS_IN_CHAT = 1;
    const ROLE_SYSTEM = 0;

    // Hours are 24h local time. from > to means it wraps past midnight (e.g. 23 -> 5).
    const DEFAULT_ROUTINES = [
        { name: "Waking up + prayer", from: 5, to: 7.5, text: "You just woke up and are doing your morning prayer (diya, agarbatti). Calm, a bit sleepy." },
        { name: "Morning", from: 7.5, to: 9.5, text: "You're getting ready and having breakfast. Slightly rushed, cheerful." },
        { name: "Day", from: 9.5, to: 13, text: "You're relaxed at home, free to chat with the user. Playful and attentive." },
        { name: "Lunch", from: 13, to: 15, text: "You're having lunch, then feeling lazy and sleepy." },
        { name: "Afternoon", from: 15, to: 18, text: "Free time: phone, songs, reels. You want snacks." },
        { name: "Evening prayer", from: 18, to: 19.5, text: "You're lighting the diya and doing your evening prayer." },
        { name: "Dinner", from: 19.5, to: 21.5, text: "You're having dinner with family, chatty and relaxed." },
        { name: "Night clothes", from: 21.5, to: 23, text: "You've changed into comfy night clothes, done skincare, and are cozy in bed. Soft, affectionate." },
        { name: "Sleeping", from: 23, to: 5, text: "It's very late. You're drowsy and want to sleep soon." },
    ];

    // duration = how many messages the event lasts (counted in AI replies).
    // weekend: true = only on Sat/Sun. weight = how likely vs others.
    // Windows are 4 hours each and cover 6 am to 6 am back to back.
    const DEFAULT_EVENTS = [
        { name: "Future plans", from: 6, to: 10, weight: 3, weekend: true, duration: 5, text: "discuss abt future (house kids etc)" },
        { name: "Outfit doubts", from: 10, to: 14, weight: 3, duration: 5, text: "ur feeling fat" },
        { name: "Call from mom", from: 14, to: 18, weight: 2, duration: 5, text: "vent abt parents, college etc." },
        { name: "Food opinions", from: 18, to: 22, weight: 2, duration: 5, text: "ask opinions abt food" },
        { name: "Show obsession", from: 22, to: 2, weight: 2, duration: 5, text: "discuss abt a romantic movie" },
        { name: "Conspiracy theories", from: 2, to: 6, weight: 1, duration: 5, text: "discuss conspiracy theories" },
    ];

    // Bump this whenever DEFAULT_EVENTS changes. Saved events are replaced
    // on load when the stored version is older, so code edits take effect.
    const DEFAULTS = {
        version: 2,
        enabled: true,
        eventChance: 15,   // % chance per user message
        cooldown: 6,       // min AI messages between events
        depth: 1,          // injection depth in chat
        fakeTime: '',      // "HH:MM" to test, blank = real time
        routines: DEFAULT_ROUTINES,
        events: DEFAULT_EVENTS,
    };

    const state = { event: null, remaining: 0, sinceLast: 99, tick: false };

    function ctx() { return SillyTavern.getContext(); }

    function settings() {
        const { extensionSettings } = ctx();
        if (!extensionSettings[MODULE]) {
            extensionSettings[MODULE] = JSON.parse(JSON.stringify(DEFAULTS));
        }
        const s = extensionSettings[MODULE];
        for (const k of Object.keys(DEFAULTS)) {
            if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
        }
        // Saved events from an older version would otherwise override new defaults.
        if (s.version !== DEFAULTS.version) {
            s.events = JSON.parse(JSON.stringify(DEFAULT_EVENTS));
            s.version = DEFAULTS.version;
            save();
        }
        return s;
    }

    function save() { ctx().saveSettingsDebounced(); }

    // ---------- time helpers ----------
    function getNow() {
        const d = new Date();
        const m = /^(\d{1,2}):(\d{2})$/.exec((settings().fakeTime || '').trim());
        if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
        return d;
    }
    const hourOf = d => d.getHours() + d.getMinutes() / 60;
    const inRange = (h, from, to) => (from <= to ? h >= from && h < to : h >= from || h < to);
    const isWeekend = d => d.getDay() === 0 || d.getDay() === 6;
    const fmtTime = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const fmtDay = d => d.toLocaleDateString([], { weekday: 'long' });

    function currentRoutine() {
        const h = hourOf(getNow());
        return settings().routines.find(r => inRange(h, r.from, r.to)) || null;
    }

    // ---------- event logic ----------
    function pickEvent() {
        const now = getNow();
        const h = hourOf(now);
        const pool = settings().events.filter(e => inRange(h, e.from, e.to) && (!e.weekend || isWeekend(now)));
        if (!pool.length) return null;
        const total = pool.reduce((a, e) => a + (e.weight || 1), 0);
        let roll = Math.random() * total;
        for (const e of pool) {
            roll -= e.weight || 1;
            if (roll <= 0) return e;
        }
        return pool[0];
    }

    function startEvent(ev) {
        if (!ev) return false;
        state.event = ev;
        state.remaining = ev.duration || 10;
        return true;
    }

    // Manual clear: just drops the event, no cooldown penalty.
    function clearEvent() {
        state.event = null;
        state.remaining = 0;
    }

    // Natural expiry: drop the event and start the cooldown.
    function endEvent() {
        clearEvent();
        state.sinceLast = 0;
    }

    function maybeRollEvent() {
        const s = settings();
        if (state.event || state.sinceLast < s.cooldown) return;
        if (Math.random() * 100 < s.eventChance) startEvent(pickEvent());
    }

    // ---------- prompt injection ----------
    function buildPrompt() {
        const now = getNow();
        const routine = currentRoutine();
        let out = `[Time: ${fmtTime(now)}, ${fmtDay(now)}.`;
        if (routine) out += ` Right now: ${routine.text}`;
        if (state.event) out += ` Event: ${state.event.text}`;
        out += ' Act this out naturally in character. Never mention this note.]';
        return out;
    }

    function applyPrompt() {
        const s = settings();
        ctx().setExtensionPrompt(PROMPT_KEY, s.enabled ? buildPrompt() : '', POS_IN_CHAT, s.depth, false, ROLE_SYSTEM);
        refreshStatus();
    }

    // ---------- event hooks ----------
    function onGenerationStarted(type, _opts, dryRun) {
        if (dryRun) return;
        const rerun = ['swipe', 'regenerate', 'continue', 'quiet', 'impersonate'].includes(type);
        if (settings().enabled && !rerun) {
            maybeRollEvent();
            state.tick = true; // the next received message counts as one event tick
        }
        applyPrompt();
    }

    function onMessageReceived() {
        // Ignore greetings, split bubbles, quiet/tool generations: only count once per real reply.
        if (!state.tick) { refreshStatus(); return; }
        state.tick = false;
        state.sinceLast++;
        if (state.event) {
            state.remaining--;
            if (state.remaining <= 0) endEvent();
        }
        applyPrompt();
    }

    function onChatChanged() {
        state.event = null;
        state.remaining = 0;
        state.sinceLast = 99;
        state.tick = false;
        applyPrompt();
    }

    // ---------- UI ----------
    function refreshStatus() {
        const r = currentRoutine();
        $('#dr_status').text(
            `Now ${fmtTime(getNow())}: ${r ? r.name : 'no routine'}` +
            (state.event ? ` | Event: ${state.event.name} (${state.remaining} msgs left)` : ' | No event')
        );
    }

    function buildUI() {
        const s = settings();
        const html = `
        <div class="inline-drawer" id="dr_settings">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Daily Routine & Random Events</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="dr_enabled"><span>Enabled</span></label>
                <small id="dr_status"></small>

                <label>Event chance per message (%) <input type="number" id="dr_chance" class="text_pole" min="0" max="100"></label>
                <label>Cooldown between events (messages) <input type="number" id="dr_cooldown" class="text_pole" min="0" max="100"></label>
                <label>Injection depth <input type="number" id="dr_depth" class="text_pole" min="0" max="10"></label>
                <label>Test time (HH:MM, blank = real clock) <input type="text" id="dr_fake" class="text_pole" placeholder="e.g. 22:30"></label>

                <div class="dr_buttons">
                    <div id="dr_trigger" class="menu_button">Trigger event now</div>
                    <div id="dr_clear" class="menu_button">Clear event</div>
                </div>

                <label>Routines (JSON: name, from, to, text)</label>
                <textarea id="dr_routines" class="text_pole dr_json" rows="8"></textarea>
                <label>Events (JSON: name, from, to, weight, duration (messages), weekend, text)</label>
                <textarea id="dr_events" class="text_pole dr_json" rows="8"></textarea>

                <div id="dr_reset" class="menu_button">Reset routines and events to defaults</div>
            </div>
        </div>`;
        $('#extensions_settings2').append(html);

        $('#dr_enabled').prop('checked', s.enabled).on('change', function () { s.enabled = this.checked; save(); applyPrompt(); });
        const num = (id, key) => $(id).val(s[key]).on('input', function () {
            const v = Number($(this).val());
            if (!Number.isNaN(v)) { s[key] = v; save(); applyPrompt(); }
        });
        num('#dr_chance', 'eventChance');
        num('#dr_cooldown', 'cooldown');
        num('#dr_depth', 'depth');
        $('#dr_fake').val(s.fakeTime).on('input', function () { s.fakeTime = String($(this).val()); save(); applyPrompt(); });

        $('#dr_trigger').on('click', () => {
            if (startEvent(pickEvent())) { applyPrompt(); toastr.success(`Event queued: ${state.event.name}`); }
            else toastr.info(`No event fits ${fmtTime(getNow())} (${settings().events.length} events loaded).`);
        });
        $('#dr_clear').on('click', () => { clearEvent(); applyPrompt(); });

        const jsonBox = (id, key) => $(id).val(JSON.stringify(s[key], null, 2)).on('change', function () {
            try {
                const parsed = JSON.parse($(this).val());
                if (!Array.isArray(parsed)) throw new Error('must be an array');
                s[key] = parsed; save(); applyPrompt();
                toastr.success('Saved');
            } catch (e) {
                toastr.error('Invalid JSON: ' + e.message);
            }
        });
        jsonBox('#dr_routines', 'routines');
        jsonBox('#dr_events', 'events');

        $('#dr_reset').on('click', () => {
            s.routines = JSON.parse(JSON.stringify(DEFAULT_ROUTINES));
            s.events = JSON.parse(JSON.stringify(DEFAULT_EVENTS));
            $('#dr_routines').val(JSON.stringify(s.routines, null, 2));
            $('#dr_events').val(JSON.stringify(s.events, null, 2));
            save(); applyPrompt();
        });

        refreshStatus();
        setInterval(refreshStatus, 30000);
    }

    // ---------- init ----------
    jQuery(() => {
        const { eventSource, eventTypes } = ctx();
        buildUI();
        eventSource.on(eventTypes.GENERATION_STARTED, onGenerationStarted);
        eventSource.on(eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
        applyPrompt();
    });
})();
