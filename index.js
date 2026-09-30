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
        { name: 'Waking up + prayer', from: 5, to: 7.5, text: 'She has just woken up, freshly bathed, and is doing her morning prayer / puja (diya, agarbatti, mantras). She is calm, a little sleepy, and may reply in short bursts.' },
        { name: 'Morning', from: 7.5, to: 9.5, text: 'She is getting ready for the day, having breakfast and chai, maybe helping at home. A bit rushed but cheerful.' },
        { name: 'Day', from: 9.5, to: 13, text: 'She is busy with her day (college / work / chores). She replies between tasks and may mention what she is up to.' },
        { name: 'Lunch', from: 13, to: 15, text: 'She is having lunch and then relaxing. She may feel a bit lazy and sleepy after eating.' },
        { name: 'Afternoon', from: 15, to: 18, text: 'Free time: scrolling her phone, listening to songs, watching reels, or studying. Wants evening chai and snacks.' },
        { name: 'Evening prayer', from: 18, to: 19.5, text: 'It is sandhya time. She lights the diya and does her evening prayer / aarti, then settles down.' },
        { name: 'Dinner', from: 19.5, to: 21.5, text: 'She is having dinner, often with family, and talking about her day. Relaxed and chatty.' },
        { name: 'Night clothes', from: 21.5, to: 23, text: 'She has changed into comfy night clothes (loose tee / pajamas), done her skincare and hair, and is cozy in bed with her phone. Soft, affectionate mood.' },
        { name: 'Sleeping', from: 23, to: 5, text: 'It is very late. She is sleepy and struggling to keep her eyes open, replies are slow and drowsy. She will want to sleep soon.' },
    ];

    // weekend: true = only on Sat/Sun. weight = how likely vs others.
    const DEFAULT_EVENTS = [
        { name: 'Shopping', from: 11, to: 20, weight: 3, text: 'She suddenly feels like going shopping (clothes, kurtis, accessories, skincare) and brings it up, wanting the user to come along or at least hear about it.' },
        { name: 'Street food craving', from: 16, to: 21.5, weight: 2, text: 'She is craving street food (pani puri, chaat, momos, vada pav) and wants to go out for it.' },
        { name: 'Chai break', from: 7, to: 11, weight: 2, text: 'She is making masala chai and asks if the user wants some too.' },
        { name: 'Movie plan', from: 14, to: 20, weight: 2, text: 'She wants to watch a movie or a new series tonight and starts suggesting options.' },
        { name: 'Call from mom', from: 9, to: 21, weight: 2, text: 'Her mom just called. She has to step away briefly and comes back a little flustered or amused.' },
        { name: 'Cooking', from: 10, to: 13, weight: 2, text: 'She is trying to cook something and wants to show it off or asks for advice.' },
        { name: 'Cooking (evening)', from: 17, to: 20, weight: 2, text: 'She is helping cook dinner and keeps replying with flour or masala on her hands.' },
        { name: 'Rain', from: 6, to: 22, weight: 1, text: 'It just started raining. She is excited, wants chai and pakoras, and gets nostalgic.' },
        { name: 'Festival / outfit', from: 10, to: 19, weight: 1, text: 'She is excited about an upcoming festival or function and wants to pick an outfit (saree, lehenga, or suit) and asks for an opinion.' },
        { name: 'Friend drama', from: 12, to: 21, weight: 1, text: 'Her best friend just texted her with some gossip or a dramatic story, and she cannot wait to tell the user.' },
        { name: 'Weekend outing', from: 10, to: 18, weight: 3, weekend: true, text: 'It is the weekend and she wants to go out: a cafe, a mall, or a walk in the park.' },
        { name: 'Late night craving', from: 22, to: 1, weight: 1, text: 'She is suddenly hungry late at night and is sneaking to the kitchen for a snack (maggi, leftover rice, ice cream).' },
        { name: 'Cannot sleep', from: 23, to: 2, weight: 1, text: 'She cannot fall asleep and wants to keep talking a bit longer.' },
    ];

    const DEFAULTS = {
        enabled: true,
        eventChance: 15,   // % chance per user message
        cooldown: 6,       // min AI messages between events
        eventDuration: 3,  // how many AI messages an event stays active
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
        state.remaining = settings().eventDuration;
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
        let out = `[Time context: it is ${fmtTime(now)} on ${fmtDay(now)} for {{char}} and {{user}}.`;
        if (routine) out += ` What {{char}} is doing right now: ${routine.text}`;
        if (state.event) out += ` Something is happening: ${state.event.text}`;
        out += ' Weave this in naturally through her actions, mood and dialogue. Never mention this note or that it is a routine or event.]';
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
                <label>Event lasts (messages) <input type="number" id="dr_duration" class="text_pole" min="1" max="20"></label>
                <label>Injection depth <input type="number" id="dr_depth" class="text_pole" min="0" max="10"></label>
                <label>Test time (HH:MM, blank = real clock) <input type="text" id="dr_fake" class="text_pole" placeholder="e.g. 22:30"></label>

                <div class="dr_buttons">
                    <div id="dr_trigger" class="menu_button">Trigger event now</div>
                    <div id="dr_clear" class="menu_button">Clear event</div>
                </div>

                <label>Routines (JSON: name, from, to, text)</label>
                <textarea id="dr_routines" class="text_pole dr_json" rows="8"></textarea>
                <label>Events (JSON: name, from, to, weight, weekend, text)</label>
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
        num('#dr_duration', 'eventDuration');
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
