class Synthesizer {
    constructor() {
        this.audioContext = null;
        this.masterGain = null;
        this.filter = null;
        this.delay = null;
        this.reverb = null;
        this.activeOscillators = new Map();
        this.waveform = 'sine';
        this.volume = 0.5;
        this.detune = 0;
        this.adsr = {
            attack: 0.1,
            decay: 0.1,
            sustain: 0.5,
            release: 0.1
        };
        this.isDragging = false;
        this.currentKnob = null;
        this.startY = 0;
        this.startValue = 0;
    }

    async init() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);

        this.filter = this.audioContext.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.connect(this.masterGain);

        this.delay = this.createDelay();
        this.reverb = await this.createReverb();

        this.setupEventListeners();
        this.createKeyboard();
        this.setupPhysicalControls();
        this.updateLCDScreen();
    }

    createDelay() {
        const delay = this.audioContext.createDelay();
        const feedback = this.audioContext.createGain();
        const delayGain = this.audioContext.createGain();

        delay.delayTime.value = 0.3;
        feedback.gain.value = 0.4;
        delayGain.gain.value = 0;

        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(delayGain);
        delayGain.connect(this.masterGain);

        return { delay, feedback, delayGain };
    }

    async createReverb() {
        const convolver = this.audioContext.createConvolver();
        const reverbGain = this.audioContext.createGain();
        reverbGain.gain.value = 0;

        const impulseLength = 2;
        const sampleRate = this.audioContext.sampleRate;
        const impulse = this.audioContext.createBuffer(2, sampleRate * impulseLength, sampleRate);

        for (let channel = 0; channel < impulse.numberOfChannels; channel++) {
            const channelData = impulse.getChannelData(channel);
            for (let i = 0; i < channelData.length; i++) {
                channelData[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.1));
            }
        }

        convolver.buffer = impulse;
        convolver.connect(reverbGain);
        reverbGain.connect(this.masterGain);

        return { convolver, reverbGain };
    }

    createOscillator(frequency) {
        if (!this.audioContext) return null;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        gainNode.gain.value = 0;

        oscillator.type = this.waveform;
        oscillator.frequency.value = frequency;
        oscillator.detune.value = this.detune;

        oscillator.connect(gainNode);
        gainNode.connect(this.filter);
        gainNode.connect(this.delay.delay);
        gainNode.connect(this.reverb.convolver);

        return { oscillator, gainNode };
    }

    noteToFrequency(note) {
        return 440 * Math.pow(2, (note - 69) / 12);
    }

    startNote(note) {
        if (!this.audioContext || this.activeOscillators.has(note)) return;

        const frequency = this.noteToFrequency(note);
        const oscillatorData = this.createOscillator(frequency);
        if (!oscillatorData) return;

        const { oscillator, gainNode } = oscillatorData;
        const now = this.audioContext.currentTime;
        
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(this.volume, now + this.adsr.attack);
        gainNode.gain.linearRampToValueAtTime(
            this.volume * this.adsr.sustain,
            now + this.adsr.attack + this.adsr.decay
        );

        oscillator.start();
        this.activeOscillators.set(note, { oscillator, gainNode });

        const key = document.querySelector(`[data-note="${note}"]`);
        if (key) key.classList.add('active');
    }

    stopNote(note) {
        if (!this.audioContext || !this.activeOscillators.has(note)) return;

        const { oscillator, gainNode } = this.activeOscillators.get(note);
        const now = this.audioContext.currentTime;

        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + this.adsr.release);

        oscillator.stop(now + this.adsr.release);
        this.activeOscillators.delete(note);

        const key = document.querySelector(`[data-note="${note}"]`);
        if (key) key.classList.remove('active');
    }

    createKeyboard() {
        const keyboard = document.querySelector('.keys');
        const octaves = 2;
        const startNote = 60;

        for (let i = 0; i < 12 * octaves; i++) {
            const note = startNote + i;
            const isBlackKey = [1, 3, 6, 8, 10].includes(i % 12);
            const key = document.createElement('div');
            
            key.className = `key ${isBlackKey ? 'key-black' : 'key-white'}`;
            key.dataset.note = note;
            
            if (isBlackKey) {
                key.style.left = `${(i - 0.5) * (100 / (12 * octaves))}%`;
            }
            
            keyboard.appendChild(key);
        }
    }

    setupPhysicalControls() {
        // Gestion des mollettes
        document.querySelectorAll('.knob').forEach(knob => {
            knob.addEventListener('mousedown', (e) => {
                this.isDragging = true;
                this.currentKnob = knob;
                this.startY = e.clientY;
                this.startValue = this.getKnobValue(knob);
                document.addEventListener('mousemove', this.handleKnobDrag);
                document.addEventListener('mouseup', () => {
                    this.isDragging = false;
                    document.removeEventListener('mousemove', this.handleKnobDrag);
                });
            });
        });

        // Gestion des sliders physiques
        document.querySelectorAll('.slider-handle').forEach(handle => {
            let isDragging = false;
            let startY = 0;
            let startTop = 0;

            handle.addEventListener('mousedown', (e) => {
                isDragging = true;
                startY = e.clientY;
                startTop = parseInt(handle.style.top || '0');
                
                const handleDrag = (e) => {
                    if (!isDragging) return;
                    const deltaY = e.clientY - startY;
                    const newTop = Math.max(0, Math.min(130, startTop + deltaY));
                    handle.style.top = `${newTop}px`;
                    
                    const value = 1 - (newTop / 130);
                    this.updateControlValue(handle.className.split(' ')[1], value);
                };

                document.addEventListener('mousemove', handleDrag);
                document.addEventListener('mouseup', () => {
                    isDragging = false;
                    document.removeEventListener('mousemove', handleDrag);
                });
            });
        });

        // Gestion du changement de mode
        document.getElementById('toggleMode').addEventListener('click', () => {
            const digitalMode = document.querySelector('.digital-mode');
            const physicalMode = document.querySelector('.physical-mode');
            digitalMode.classList.toggle('hidden');
            physicalMode.classList.toggle('hidden');
        });
    }

    handleKnobDrag = (e) => {
        if (!this.isDragging || !this.currentKnob) return;
        
        const deltaY = this.startY - e.clientY;
        const sensitivity = 200;
        const newValue = Math.max(0, Math.min(1, this.startValue + (deltaY / sensitivity)));
        
        const rotation = newValue * 270 - 135;
        this.currentKnob.querySelector('.knob-dot').style.transform = `rotate(${rotation}deg)`;
        
        const control = this.currentKnob.dataset.control;
        this.updateControlValue(control, newValue);
    }

    getKnobValue(knob) {
        const dot = knob.querySelector('.knob-dot');
        const transform = dot.style.transform || 'rotate(-135deg)';
        const rotation = parseInt(transform.match(/-?\d+/)[0]) || -135;
        return (rotation + 135) / 270;
    }

    updateControlValue(control, value) {
        const digitalInput = document.querySelector(`.${control}-control`);
        if (digitalInput) digitalInput.value = value;

        switch(control) {
            case 'volume':
                this.volume = value;
                if (this.masterGain) this.masterGain.gain.value = value;
                break;
            case 'filter':
                if (this.filter) this.filter.frequency.value = value * 20000;
                break;
            case 'resonance':
                if (this.filter) this.filter.Q.value = value * 30;
                break;
            case 'attack':
                this.adsr.attack = value * 2;
                break;
            case 'decay':
                this.adsr.decay = value * 2;
                break;
            case 'sustain':
                this.adsr.sustain = value;
                break;
            case 'release':
                this.adsr.release = value * 2;
                break;
            case 'delay':
                if (this.delay) this.delay.delayGain.gain.value = value;
                break;
            case 'reverb':
                if (this.reverb) this.reverb.reverbGain.gain.value = value;
                break;
        }

        this.updateLCDScreen();
    }

    updateLCDScreen() {
        const waveDisplay = document.querySelector('.wave-display');
        const volumeDisplay = document.querySelector('.volume-display');
        const filterDisplay = document.querySelector('.filter-display');
        
        if (waveDisplay) waveDisplay.textContent = this.waveform;
        if (volumeDisplay) volumeDisplay.textContent = `${Math.round(this.volume * 100)}%`;
        if (filterDisplay) filterDisplay.textContent = `${Math.round(this.filter?.frequency.value || 0)}Hz`;
    }

    setupEventListeners() {
        // Gestion du clavier virtuel
        document.querySelector('.keyboard').addEventListener('mousedown', (e) => {
            const key = e.target.closest('.key');
            if (key) {
                const note = parseInt(key.dataset.note);
                this.startNote(note);
            }
        });

        document.querySelector('.keyboard').addEventListener('mouseup', (e) => {
            const key = e.target.closest('.key');
            if (key) {
                const note = parseInt(key.dataset.note);
                this.stopNote(note);
            }
        });

        // Gestion du clavier physique
        const keyboardMap = {
            'q': 60,
            'z': 61,
            's': 62,
            'e': 63,
            'd': 64,
            'f': 65,
            't': 66,
            'g': 67,
            'y': 68,
            'h': 69,
            'u': 70,
            'j': 71,
            'k': 72
        };

        document.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            const note = keyboardMap[e.key.toLowerCase()];
            if (note) this.startNote(note);
        });

        document.addEventListener('keyup', (e) => {
            const note = keyboardMap[e.key.toLowerCase()];
            if (note) this.stopNote(note);
        });

        // Contrôles de forme d'onde
        document.querySelectorAll('.wave-btn, .physical-wave-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const isPhysical = btn.classList.contains('physical-wave-btn');
                const wave = btn.dataset.wave;
                
                // Mettre à jour les deux modes
                document.querySelectorAll('.wave-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.physical-wave-btn').forEach(b => b.classList.remove('active'));
                
                document.querySelector(`.wave-btn[data-wave="${wave}"]`)?.classList.add('active');
                document.querySelector(`.physical-wave-btn[data-wave="${wave}"]`)?.classList.add('active');
                
                this.waveform = wave;
                this.updateLCDScreen();
            });
        });

        // Contrôles numériques
        const controls = {
            '.volume-control': (value) => {
                this.volume = parseFloat(value);
                if (this.masterGain) this.masterGain.gain.value = this.volume;
            },
            '.detune-control': (value) => {
                this.detune = parseFloat(value);
                this.activeOscillators.forEach(({ oscillator }) => {
                    oscillator.detune.value = this.detune;
                });
            },
            '.filter-freq': (value) => {
                if (this.filter) this.filter.frequency.value = parseFloat(value);
            },
            '.filter-q': (value) => {
                if (this.filter) this.filter.Q.value = parseFloat(value);
            },
            '.attack-control': (value) => this.adsr.attack = parseFloat(value),
            '.decay-control': (value) => this.adsr.decay = parseFloat(value),
            '.sustain-control': (value) => this.adsr.sustain = parseFloat(value),
            '.release-control': (value) => this.adsr.release = parseFloat(value),
            '.delay-control': (value) => {
                if (this.delay) this.delay.delayGain.gain.value = parseFloat(value);
            },
            '.reverb-control': (value) => {
                if (this.reverb) this.reverb.reverbGain.gain.value = parseFloat(value);
            }
        };

        Object.entries(controls).forEach(([selector, handler]) => {
            document.querySelector(selector)?.addEventListener('input', (e) => {
                handler(e.target.value);
                this.updateLCDScreen();
            });
        });
    }
}

// Initialisation du synthétiseur
let synth = new Synthesizer();

// Activer le son au premier clic
document.addEventListener('click', async () => {
    if (!synth.audioContext) {
        await synth.init();
    }
}, { once: true });
