// Daily Routine & Random Events - SillyTavern extension
// Injects a hidden time-aware note before each generation:
//  1) what the character is doing right now (routine, based on your real clock)
//  2) occasionally a random, time-appropriate event (shopping, chai run, etc.)

(() => {
    const MODULE = 'daily_routine';
    const PROMPT_KEY = 'daily_routine_prompt';

    // setExtensionPrompt constants
    const POS_IN_CHAT = 1;
    const ROLE_SYSTEM = 0;

    // Hours are 24h local time. from > to means it wraps past midnight (e.g. 23 -> 5).
    const DEFAULT_ROUTINES = [
        { name: "Waking up + prayer", from: 5, to: 7.5, text: "You just woke up and are doing your morning prayer (diya, agarbatti). Calm, a bit sleepy." },
        { name: "Morning", from: 7.5, to: 9.5, text: "You're getting ready and having breakfast and chai. Slightly rushed, cheerful." },
        { name: "Day", from: 9.5, to: 13, text: "You're relaxed at home, free to chat with the user. Playful and attentive." },
        { name: "Lunch", from: 13, to: 15, text: "You're having lunch, then feeling lazy and sleepy." },
        { name: "Afternoon", from: 15, to: 18, text: "Free time: phone, songs, reels. You want chai and snacks." },
        { name: "Evening prayer", from: 18, to: 19.5, text: "You're lighting the diya and doing your evening prayer." },
        { name: "Dinner", from: 19.5, to: 21.5, text: "You're having dinner with family, chatty and relaxed." },
        { name: "Night clothes", from: 21.5, to: 23, text: "You've changed into comfy night clothes, done skincare, and are cozy in bed. Soft, affectionate." },
        { name: "Sleeping", from: 23, to: 5, text: "It's very late. You're drowsy and want to sleep soon." },
    ];

    // duration = how many messages the event lasts (1 message = 1 minute).
    // weekend: true = only on Sat/Sun. weight = how likely vs others.
    const DEFAULT_EVENTS = [
        { name: "Shopping", from: 11, to: 20, weight: 3, duration: 40, text: "You want to go shopping (clothes, kurtis, skincare) and ask the user to come along." },
        { name: "Street food craving", from: 16, to: 21.5, weight: 2, duration: 25, text: "You're craving street food (pani puri, chaat, momos) and want to go out for it." },
        { name: "Chai break", from: 7, to: 11, weight: 2, duration: 10, text: "You're making masala chai and ask if the user wants some." },
        { name: "Movie night", from: 14, to: 20, weight: 2, duration: 60, text: "You want to watch a movie or series and suggest options." },
        { name: "Call from mom", from: 9, to: 21, weight: 2, duration: 8, text: "Your mom called. You step away briefly, then come back a bit flustered." },
        { name: "Cooking", from: 10, to: 13, weight: 2, duration: 30, text: "You're trying a new recipe and want to show it off or get advice." },
        { name: "Cooking (evening)", from: 17, to: 20, weight: 2, duration: 35, text: "You're helping cook dinner and reply with messy hands." },
        { name: "Rain", from: 6, to: 22, weight: 1, duration: 15, text: "It just started raining. You're excited and want chai and pakoras." },
        { name: "Festival outfit", from: 10, to: 19, weight: 1, duration: 25, text: "You're excited for an upcoming festival and picking an outfit (saree, lehenga, suit). Ask for opinions." },
        { name: "Friend drama", from: 12, to: 21, weight: 1, duration: 12, text: "Your best friend just texted some gossip and you can't wait to tell the user." },
        { name: "Weekend outing", from: 10, to: 18, weight: 3, weekend: true, duration: 60, text: "It's the weekend and you want to go out (cafe, mall, park)." },
        { name: "Late night craving", from: 22, to: 1, weight: 1, duration: 10, text: "You're hungry late at night and sneaking to the kitchen for a snack." },
        { name: "Can't sleep", from: 23, to: 2, weight: 1, duration: 20, text: "You can't sleep and want to keep talking a bit longer." },
    ];

    const DEFAULTS = {
        enabled: true,
        eventChance: 15,   // % chance per user message
        cooldown: 6,       // min AI messages between events
        depth: 1,          // injection depth in chat
        fakeTime: '',      // "HH:MM" to test, blank = real time
        routines: DEFAULT_ROUTINES,
        events: DEFAULT_EVENTS,
    };

    const state = { event: null, remaining: 0, sinceLast: 99 };

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

    function clearEvent() {
        state.event = null;
        state.remaining = 0;
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
        if (settings().enabled && !rerun) maybeRollEvent();
        applyPrompt();
    }

    function onMessageReceived() {
        state.sinceLast++;
        if (state.event) {
            state.remaining--;
            if (state.remaining <= 0) clearEvent();
        }
        refreshStatus();
    }

    function onChatChanged() {
        state.event = null;
        state.remaining = 0;
        state.sinceLast = 99;
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
            else toastr.info('No event fits this time of day.');
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
