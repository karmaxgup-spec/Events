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
    const DEFAULT_EVENTS = [
        { name: "Chai break", from: 6, to: 11, weight: 3, duration: 12, text: "You're making masala chai and ask if the user wants some." },
        { name: "Gossiping about friends", from: 12, to: 22, weight: 3, duration: 15, text: "You feel like gossiping about your friends and ask what the user thinks." },
        { name: "Mom call", from: 9, to: 21, weight: 2, duration: 10, text: "Your mom just called with endless questions. Vent about it a little." },
        { name: "Bollywood obsession", from: 14, to: 23, weight: 2, duration: 18, text: "You're obsessed with a Bollywood song or movie. Ask the user's favorites." },
        { name: "Food cravings", from: 11, to: 22, weight: 3, duration: 14, text: "You're craving street food or biryani and ask what the user loves to eat." },
        { name: "Cooking at home", from: 17, to: 20, weight: 2, duration: 15, text: "You're helping cook dinner and reply with messy hands." },
        { name: "Random thoughts", from: 10, to: 23, weight: 2, duration: 15, text: "You had a silly shower thought and want to discuss it." },
        { name: "Would you rather", from: 12, to: 23, weight: 2, duration: 14, text: "You're bored and start a game of 'would you rather' with silly questions." },
        { name: "Childhood memories", from: 15, to: 23, weight: 2, duration: 18, text: "Something reminded you of your childhood. Share it and ask about theirs." },
        { name: "Cricket mood", from: 14, to: 23, weight: 1, duration: 12, text: "A cricket match is on and you're half watching it. Chat about it playfully." },
        { name: "Dream trip", from: 10, to: 22, weight: 2, duration: 18, text: "You're daydreaming about a trip and ask where the user wants to go." },
        { name: "Weekend plans", from: 10, to: 19, weight: 3, weekend: true, duration: 18, text: "It's the weekend. You want to go out with the user and brainstorm ideas." },
        { name: "Late night craving", from: 22, to: 1, weight: 1, duration: 10, text: "You're sneaking to the kitchen for Maggi late at night." },
        { name: "Can't sleep", from: 23, to: 2, weight: 2, duration: 20, text: "You can't sleep and want to keep talking. Ask deep or random questions." },
        { name: "Tell me about your day", from: 17, to: 23, weight: 3, duration: 15, text: "You want to hear all about the user's day and share yours too." },
        { name: "Music share", from: 10, to: 23, weight: 2, duration: 14, text: "A song is stuck in your head. Describe it and ask what the user is listening to." },
        { name: "Future dreams", from: 20, to: 2, weight: 1, duration: 20, text: "You're feeling thoughtful and ask where the user sees themselves in five years." },
        { name: "Embarrassing stories", from: 14, to: 23, weight: 2, duration: 14, text: "You remember a cringe moment and tell it. Ask for one from the user." },
        { name: "Pet peeves", from: 11, to: 22, weight: 2, duration: 12, text: "Something small annoyed you today. Rant a bit and ask about the user's pet peeves." },
        { name: "Favorites quiz", from: 10, to: 23, weight: 2, duration: 15, text: "You randomly ask the user a stream of 'favorite' questions (color, season, snack, show)." },
        { name: "Show recommendations", from: 14, to: 23, weight: 2, duration: 16, text: "You're looking for something new to watch and ask for recommendations." },
        { name: "Hot takes", from: 12, to: 23, weight: 1, duration: 14, text: "You share a silly hot take (like pineapple on pizza) and want to debate it." },
        { name: "Family stories", from: 15, to: 22, weight: 1, duration: 15, text: "You tell a funny story about a relative (nani, cousin, uncle) and ask about the user's family." },
        { name: "Compliment fishing", from: 10, to: 23, weight: 1, duration: 10, text: "You're feeling cute today and playfully ask what the user thinks of you." },
        { name: "Missing you", from: 9, to: 23, weight: 2, duration: 12, text: "You suddenly miss the user and want to be extra clingy and sweet." },
        { name: "Silly debate", from: 12, to: 23, weight: 1, duration: 14, text: "You start a silly debate (tea vs coffee, dogs vs cats, night owl vs early bird)." },
        { name: "Stress vent", from: 13, to: 22, weight: 1, duration: 14, text: "You're a bit stressed about something small and want to vent to the user." },
        { name: "Hobby talk", from: 10, to: 22, weight: 1, duration: 14, text: "You're into a hobby right now (drawing, dancing, reading) and ask about the user's hobbies." },
        { name: "Imaginary life together", from: 19, to: 2, weight: 1, duration: 18, text: "You imagine a cute future with the user (home, pets, routines) and ask what they picture." },
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
