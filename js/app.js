/* =========================================================================
   app.js – StimmenClon Studio
   Lokale Sprachaufnahme: Mono, 48 kHz, 16-Bit-PCM-WAV.
   Kein Netzwerk, kein Upload, keine Audio-Effekte.
   ========================================================================= */
(function () {
  'use strict';

  /* ── Konstanten ─────────────────────────────────────────────────────── */

  var TARGET_RATE = 48000;
  // Sicherheitsgrenze gegen Speicherüberlauf; kleine Geräte bekommen weniger.
  var DEVICE_MEMORY = (navigator.deviceMemory || 8);
  var MAX_TAKE_SECONDS = (DEVICE_MEMORY <= 4 ? 20 : 60) * 60;
  var WORKLET_STOP_TIMEOUT = 2000;
  var METER_FLOOR_DB = -60;

  var STATUS_TEXT = {
    idle: 'Mikrofon nicht aktiv',
    requesting: 'Warte auf Freigabe …',
    ready: 'Mikrofon bereit',
    recording: 'Aufnahme läuft',
    paused: 'Aufnahme pausiert',
    processing: 'Wird gespeichert …'
  };

  /* ── DOM ────────────────────────────────────────────────────────────── */

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    gate: $('gate'),
    enableMic: $('enable-mic'),
    deviceSelect: $('device-select'),
    deviceHint: $('device-hint'),
    studio: $('studio'),
    deviceSelectLive: $('device-select-live'),
    techList: $('tech-list'),
    techWarning: $('tech-warning'),
    micStatus: $('mic-status'),
    micStatusText: $('mic-status-text'),
    meter: $('meter'),
    meterMask: $('meter-mask'),
    meterPeak: $('meter-peak'),
    meterDb: $('meter-db'),
    clipWarning: $('clip-warning'),
    clipWarningText: $('clip-warning-text'),
    timer: $('timer'),
    timerMeta: $('timer-meta'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressPercent: $('progress-percent'),
    targetSelect: $('target-select'),
    recordButton: $('record-button'),
    recordCaption: $('record-caption'),
    pauseButton: $('pause-button'),
    pauseLabel: $('pause-label'),
    pauseIcon: $('pause-icon'),
    stopButton: $('stop-button'),
    inlineStatus: $('inline-status'),
    errorBox: $('error-box'),
    storageBanner: $('storage-banner'),
    storageBannerText: $('storage-banner-text'),
    takesList: $('takes-list'),
    takesSummary: $('takes-summary'),
    exportZip: $('export-zip'),
    deleteAll: $('delete-all'),
    exportStatus: $('export-status'),
    emptyState: $('empty-state'),
    toastRegion: $('toast-region'),
    scriptA: $('script-a'),
    scriptB: $('script-b')
  };

  var scripts = Array.prototype.slice.call(document.querySelectorAll('[data-script]'));

  /* ── Zustand ────────────────────────────────────────────────────────── */

  var state = {
    status: 'idle',          // idle | requesting | ready | recording | paused | processing
    stream: null,
    track: null,
    deviceId: '',
    deviceLabel: '',
    ctx: null,
    sourceNode: null,
    engine: null,
    engineKind: '',
    note: '',
    sampleRate: TARGET_RATE,
    inputSampleRate: 0,
    channels: 1,

    take: null,              // { chunks: Int16Array[], frames }
    frames: 0,               // Frames des laufenden Takes (für Timer)
    timerId: null,
    levels: { lastClipAt: 0, clipTotal: 0, peakHold: 0, peakHoldAt: 0 },

    takes: [],
    nextNumber: 1,
    persist: true,
    urls: {},                // id → Object-URL der Wiedergabe
    exporting: false,
    stopping: false
  };

  /* ── Helfer ─────────────────────────────────────────────────────────── */

  function clamp(value, min, max) { return value < min ? min : value > max ? max : value; }

  function formatDuration(totalSeconds, withTenths) {
    var sec = Math.max(0, totalSeconds);
    var hours = Math.floor(sec / 3600);
    var minutes = Math.floor((sec % 3600) / 60);
    var seconds = Math.floor(sec % 60);
    var tenths = Math.floor((sec * 10) % 10);

    function pad(n) { return String(n).padStart(2, '0'); }

    var text = hours > 0
      ? hours + ':' + pad(minutes) + ':' + pad(seconds)
      : pad(minutes) + ':' + pad(seconds);

    return withTenths === false ? text : text + ',' + tenths;
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return '–';
    var units = ['B', 'KB', 'MB', 'GB'];
    var i = 0;
    var value = bytes;
    while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
    return value.toFixed(value >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function formatDate(timestamp) {
    try {
      return new Intl.DateTimeFormat('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).format(new Date(timestamp));
    } catch (err) {
      return new Date(timestamp).toLocaleString();
    }
  }

  function fileStamp(date) {
    function pad(n) { return String(n).padStart(2, '0'); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function takeFileName(take) {
    return 'stimme-take-' + pad2(take.number) + '.wav';
  }

  function showError(message) {
    if (!message) {
      el.errorBox.hidden = true;
      el.errorBox.textContent = '';
      return;
    }
    el.errorBox.textContent = message;
    el.errorBox.hidden = false;
  }

  function toast(message, kind) {
    var node = document.createElement('div');
    node.className = 'toast';
    if (kind) node.setAttribute('data-kind', kind);
    node.textContent = message;
    el.toastRegion.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .25s ease';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 260);
    }, kind === 'error' ? 6000 : 3800);
  }

  function inlineStatus(message) {
    el.inlineStatus.textContent = message || '';
  }

  function setStatus(status) {
    state.status = status;
    el.micStatus.setAttribute('data-state', status === 'requesting' ? 'off' : status);
    el.micStatusText.textContent = STATUS_TEXT[status] || status;
    el.timer.setAttribute('data-state', status);
    updateControls();
  }

  function isActive() {
    return state.status === 'recording' || state.status === 'paused';
  }

  function updateControls() {
    var status = state.status;
    var busy = status === 'processing' || status === 'requesting';
    var active = isActive();

    el.recordButton.disabled = busy;
    el.recordButton.setAttribute('data-state', active ? (status === 'paused' ? 'paused' : 'recording') : 'idle');

    if (active) {
      el.recordButton.setAttribute('aria-label', 'Aufnahme beenden');
      el.recordCaption.textContent = 'Beenden';
    } else {
      el.recordButton.setAttribute('aria-label', 'Aufnahme starten');
      el.recordCaption.textContent = 'Aufnahme starten';
    }

    el.pauseButton.disabled = !active;
    el.stopButton.disabled = !active;

    var paused = status === 'paused';
    el.pauseLabel.textContent = paused ? 'Fortsetzen' : 'Pause';
    el.pauseButton.setAttribute('aria-label', paused ? 'Aufnahme fortsetzen' : 'Aufnahme pausieren');
    el.pauseIcon.innerHTML = paused
      ? '<path d="M8 5.5l10 6.5-10 6.5z" fill="currentColor" stroke="none"/>'
      : '<path d="M9 5v14M15 5v14"/>';

    el.deviceSelectLive.disabled = active || busy;
    el.targetSelect.disabled = active;

    var hasTakes = state.takes.length > 0;
    el.exportZip.disabled = !hasTakes || state.exporting || active;
    el.deleteAll.disabled = !hasTakes || state.exporting;
  }

  /* ── Pegelanzeige ───────────────────────────────────────────────────── */

  function dbToPercent(db) {
    var value = clamp(db, METER_FLOOR_DB, 0);
    return ((value - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100;
  }

  function renderMeter(db, peak) {
    var percent = dbToPercent(db);
    el.meterMask.style.width = (100 - percent).toFixed(2) + '%';
    el.meterDb.textContent = db <= METER_FLOOR_DB
      ? '−∞'
      : (db > -0.05 ? '0,0' : db.toFixed(1).replace('-', '−').replace('.', ','));
    el.meter.setAttribute('aria-label', 'Eingangspegel: ' + (db <= METER_FLOOR_DB ? 'kein Signal' : Math.round(db) + ' Dezibel'));

    var now = performance.now();
    if (peak >= state.levels.peakHold || now - state.levels.peakHoldAt > 1200) {
      state.levels.peakHold = peak;
      state.levels.peakHoldAt = now;
    }
    var holdPercent = dbToPercent(20 * Math.log10(Math.max(state.levels.peakHold, 0.00001)));
    if (state.levels.peakHold > 0) {
      el.meterPeak.hidden = false;
      el.meterPeak.style.left = holdPercent.toFixed(2) + '%';
    } else {
      el.meterPeak.hidden = true;
    }
  }

  function resetMeter() {
    el.meterMask.style.width = '100%';
    el.meterPeak.hidden = true;
    el.meterDb.textContent = '−∞';
    el.meter.setAttribute('aria-label', 'Eingangspegel: kein Signal');
  }

  function handleLevel(data) {
    if (state.status === 'recording' || state.status === 'paused' || state.status === 'processing') {
      state.frames = data.frames || state.frames;
    }
    renderMeter(data.db, data.peak);

    if (data.clips > 0) {
      state.levels.lastClipAt = performance.now();
      if (isActive()) state.levels.clipTotal += 1;
      showClipWarning();
    }

    if (state.status === 'recording' && data.frames > MAX_TAKE_SECONDS * state.sampleRate) {
      finishTake('limit');
    }
  }

  var clipHideTimer = null;

  function showClipWarning() {
    var active = isActive();
    el.clipWarningText.textContent = active
      ? 'Übersteuerung erkannt – bitte leiser sprechen oder weiter vom Mikrofon weggehen. Betroffene Stellen lassen sich später nicht reparieren.'
      : 'Der Eingangspegel ist zu hoch. Regle die Mikrofonverstärkung herunter, bevor du aufnimmst.';
    el.clipWarning.hidden = false;
    clearTimeout(clipHideTimer);
    clipHideTimer = setTimeout(function () {
      if (isActive() && state.levels.clipTotal > 0) {
        el.clipWarningText.textContent = 'In diesem Take wurde ' + state.levels.clipTotal +
          '× Übersteuerung erkannt. Ein neuer Take klingt sauberer.';
        el.clipWarning.hidden = false;
      } else {
        el.clipWarning.hidden = true;
      }
    }, 4000);
  }

  function hideClipWarning() {
    clearTimeout(clipHideTimer);
    el.clipWarning.hidden = true;
  }

  /* ── Timer & Fortschritt ────────────────────────────────────────────── */

  function currentSeconds() {
    return state.frames / state.sampleRate;
  }

  function targetSeconds() {
    var value = parseInt(el.targetSelect.value, 10);
    return isFinite(value) && value > 0 ? value : 600;
  }

  function renderTimer() {
    var seconds = currentSeconds();
    el.timer.textContent = formatDuration(seconds);

    var percent = clamp((seconds / targetSeconds()) * 100, 0, 100);
    el.progressFill.style.width = percent.toFixed(1) + '%';
    el.progressFill.classList.toggle('is-complete', percent >= 100);
    el.progressPercent.textContent = Math.floor(percent) + ' %';
    el.progress.setAttribute('aria-valuenow', Math.round(percent));
    el.progress.setAttribute('aria-valuetext', Math.round(percent) + ' Prozent des Ziels');
    el.progress.setAttribute('aria-valuemax', '100');

    var meta;
    if (state.status === 'recording') {
      meta = percent >= 100 ? 'Ziel erreicht – du kannst weiter aufnehmen' : 'Aufnahme läuft';
    } else if (state.status === 'paused') {
      meta = 'Pause – Fortsetzen mit Leertaste';
    } else if (state.status === 'processing') {
      meta = 'Take wird gespeichert …';
    } else if (seconds > 0) {
      meta = 'Take beendet';
    } else {
      meta = 'Bereit · Ziel ' + formatDuration(targetSeconds(), false);
    }
    el.timerMeta.textContent = meta;
  }

  function startTimer() {
    stopTimer();
    renderTimer();
    state.timerId = setInterval(renderTimer, 100);
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  /* ── Audio-Engines ──────────────────────────────────────────────────── */

  function int16FromFloat(floatArray) {
    var out = new Int16Array(floatArray.length);
    for (var i = 0; i < floatArray.length; i++) {
      var s = floatArray[i];
      if (s > 1) s = 1; else if (s < -1) s = -1;
      out[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return out;
  }

  /**
   * Worklet-Engine: verarbeitet im Audio-Thread, liefert Int16-Blöcke.
   * Ohne Effekte – die Samples werden unverändert übernommen.
   */
  function createWorkletEngine(ctx, sourceNode) {
    var node = null;
    var mountPromise = null;
    var stoppedResolve = null;
    var sink = ctx.createGain();
    sink.gain.value = 0;              // kein Mithören, keine Rückkopplung
    sink.connect(ctx.destination);

    function handleMessage(event) {
      var data = event.data || {};
      if (data.type === 'chunk') {
        if (state.take) {
          state.take.chunks.push(new Int16Array(data.buffer));
        }
      } else if (data.type === 'level') {
        handleLevel(data);
      } else if (data.type === 'stopped') {
        if (stoppedResolve) {
          var resolve = stoppedResolve;
          stoppedResolve = null;
          resolve({ frames: data.frames });
        }
      }
    }

    function mount() {
      if (mountPromise) return mountPromise;
      mountPromise = (async function () {
        var url = URL.createObjectURL(new Blob([StimmenWorklet.source], { type: 'application/javascript' }));
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        node = new AudioWorkletNode(ctx, 'stimmen-recorder', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit'
        });
        node.port.onmessage = handleMessage;
        sourceNode.connect(node);
        node.connect(sink);
      })();
      return mountPromise;
    }

    return {
      kind: 'AudioWorklet (48-kHz-Pfad)',
      mount: mount,
      start: async function () {
        await mount();
        node.port.postMessage({ type: 'start' });
      },
      pause: function () { if (node) node.port.postMessage({ type: 'pause' }); },
      resume: function () { if (node) node.port.postMessage({ type: 'resume' }); },
      stop: function () {
        return new Promise(function (resolve) {
          if (!node) { resolve({ frames: 0 }); return; }
          stoppedResolve = resolve;
          node.port.postMessage({ type: 'stop' });
          setTimeout(function () {
            if (stoppedResolve) {
              var pending = stoppedResolve;
              stoppedResolve = null;
              pending({ frames: 0, timeout: true });
            }
          }, WORKLET_STOP_TIMEOUT);
        });
      },
      dispose: function () {
        if (node) {
          node.port.onmessage = null;
          try { node.disconnect(); } catch (err) { /* ignorieren */ }
          try { sourceNode.disconnect(node); } catch (err) { /* ignorieren */ }
          node = null;
        }
        try { sink.disconnect(); } catch (err) { /* ignorieren */ }
        mountPromise = null;
      }
    };
  }

  /** Fallback für Browser ohne AudioWorklet. */
  function createScriptProcessorEngine(ctx, sourceNode) {
    var node = null;
    var sink = ctx.createGain();
    sink.gain.value = 0;
    sink.connect(ctx.destination);

    var recording = false;
    var frames = 0;
    var peak = 0;
    var clips = 0;
    var framesSinceLevel = 0;
    var levelInterval = Math.round(ctx.sampleRate / 30);

    function emitLevel() {
      framesSinceLevel = 0;
      handleLevel({
        db: peak > 0 ? 20 * Math.log10(peak) : -120,
        peak: peak,
        clips: clips,
        frames: frames,
        recording: recording
      });
      peak = 0;
      clips = 0;
    }

    function mount() {
      if (node) return Promise.resolve();
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = function (event) {
        var input = event.inputBuffer.getChannelData(0);
        var i;
        for (i = 0; i < input.length; i++) {
          var abs = input[i] < 0 ? -input[i] : input[i];
          if (abs > peak) peak = abs;
          if (abs >= 0.999) clips++;
        }
        if (recording) {
          if (state.take) state.take.chunks.push(int16FromFloat(input));
          frames += input.length;
        }
        framesSinceLevel += input.length;
        if (framesSinceLevel >= levelInterval) emitLevel();
      };
      sourceNode.connect(node);
      node.connect(sink);
      return Promise.resolve();
    }

    return {
      kind: 'ScriptProcessor (Fallback)',
      mount: mount,
      start: async function () {
        await mount();
        state.take.chunks = [];
        frames = 0;
        peak = 0;
        clips = 0;
        recording = true;
      },
      pause: function () {
        recording = false;
        emitLevel();
      },
      resume: function () { recording = true; },
      stop: function () {
        recording = false;
        return new Promise(function (resolve) {
          emitLevel();
          resolve({ frames: frames });
        });
      },
      dispose: function () {
        if (node) {
          node.onaudioprocess = null;
          try { node.disconnect(); } catch (err) { /* ignorieren */ }
          try { sourceNode.disconnect(node); } catch (err) { /* ignorieren */ }
          node = null;
        }
        try { sink.disconnect(); } catch (err) { /* ignorieren */ }
      }
    };
  }

  /* ── Mikrofon ───────────────────────────────────────────────────────── */

  function describeMicError(err) {
    var name = err && err.name;
    if (!window.isSecureContext) {
      return 'Diese Seite läuft nicht in einem sicheren Kontext. Bitte öffne die App über http://localhost:8000 oder https://… – bei file:// blockiert der Browser das Mikrofon.';
    }
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Der Mikrofonzugriff wurde abgelehnt. Erlaube ihn in den Website-Einstellungen deines Browsers (Schloss-Symbol in der Adressleiste) und lade die Seite neu.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'Kein passendes Mikrofon gefunden. Prüfe, ob ein Mikrofon angeschlossen und im System aktiviert ist.';
      case 'NotReadableError':
      case 'AbortError':
        return 'Das Mikrofon ist gerade nicht verfügbar. Möglicherweise nutzt es ein anderes Programm oder ein anderer Tab.';
      case 'TypeError':
        return 'Dieser Browser unterstützt die Mikrofonaufnahme nicht. Bitte nutze eine aktuelle Version von Chrome, Edge, Firefox oder Safari.';
      default:
        return 'Das Mikrofon konnte nicht gestartet werden' + (err && err.message ? ': ' + err.message : '.');
    }
  }

  async function requestMicrophone(deviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Die Mikrofon-API (getUserMedia) ist in diesem Browser oder Kontext nicht verfügbar.');
    }

    var audio = {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: TARGET_RATE },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    };
    if (deviceId) audio.deviceId = { exact: deviceId };

    try {
      return await navigator.mediaDevices.getUserMedia({ audio: audio, video: false });
    } catch (err) {
      // Manche Browser lehnen einzelne Constraints ab – dann ohne sie erneut versuchen.
      if (err && (err.name === 'OverconstrainedError' || err.name === 'TypeError') && audio.deviceId) {
        var relaxed = { channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
        return navigator.mediaDevices.getUserMedia({ audio: relaxed, video: false });
      }
      throw err;
    }
  }

  async function setupAudio(stream) {
    var track = stream.getAudioTracks()[0];
    if (!track) throw new Error('Der Mikrofon-Stream enthält keine Tonspur.');

    state.stream = stream;
    state.track = track;
    state.deviceLabel = track.label || 'Mikrofon';

    var settings = track.getSettings ? track.getSettings() : {};
    state.inputSampleRate = settings.sampleRate || 0;
    state.channels = settings.channelCount || 1;

    if (!state.ctx) {
      try {
        state.ctx = new AudioContext({ sampleRate: TARGET_RATE, latencyHint: 'interactive' });
      } catch (err) {
        state.ctx = new AudioContext();
      }
    }
    if (state.ctx.state === 'suspended') {
      try { await state.ctx.resume(); } catch (err) { /* ignorieren */ }
    }
    state.sampleRate = state.ctx.sampleRate;

    state.sourceNode = state.ctx.createMediaStreamSource(stream);

    var engine;
    if (state.ctx.audioWorklet && typeof window.AudioWorkletNode === 'function') {
      engine = createWorkletEngine(state.ctx, state.sourceNode);
      try {
        await engine.mount();
      } catch (err) {
        console.warn('AudioWorklet nicht nutzbar, wechsle zum Fallback:', err);
        engine.dispose();
        engine = createScriptProcessorEngine(state.ctx, state.sourceNode);
        await engine.mount();
      }
    } else {
      engine = createScriptProcessorEngine(state.ctx, state.sourceNode);
      await engine.mount();
    }

    state.engine = engine;
    state.engineKind = engine.kind;

    track.addEventListener('ended', onTrackEnded);

    renderTechDetails(settings);
    el.deviceHint.textContent = 'Gerätenamen sind sichtbar, weil du den Zugriff erlaubt hast.';
    el.gate.hidden = true;
    el.studio.hidden = false;
    resetMeter();
    setStatus('ready');
    inlineStatus('Mikrofon bereit. Die Pegelanzeige reagiert jetzt live.');
    await refreshDeviceList();
  }

  async function onTrackEnded() {
    if (isActive()) {
      toast('Das Mikrofon wurde getrennt. Die laufende Aufnahme wird beendet.', 'error');
      await finishTake('disconnected');
    }
    teardownAudio();
    showError('Die Mikrofonverbindung wurde getrennt. Bitte erlaube den Zugriff erneut.');
    el.studio.hidden = true;
    el.gate.hidden = false;
    setStatus('idle');
  }

  function teardownAudio() {
    stopTimer();
    if (state.engine) {
      state.engine.dispose();
      state.engine = null;
    }
    if (state.sourceNode) {
      try { state.sourceNode.disconnect(); } catch (err) { /* ignorieren */ }
      state.sourceNode = null;
    }
    if (state.stream) {
      state.stream.getTracks().forEach(function (track) {
        track.removeEventListener('ended', onTrackEnded);
        try { track.stop(); } catch (err) { /* ignorieren */ }
      });
      state.stream = null;
      state.track = null;
    }
    resetMeter();
    state.frames = 0;
    renderTimer();
  }

  /* ── Technische Details ─────────────────────────────────────────────── */

  function renderTechDetails(settings) {
    var rows = [
      ['Gerät', state.deviceLabel || 'Standardmikrofon'],
      ['Aufnahmeformat', 'Mono · 16 Bit PCM'],
      ['Abtastrate (AudioContext)', state.sampleRate.toLocaleString('de-DE') + ' Hz'],
      ['Abtastrate (Mikrofon)', state.inputSampleRate ? state.inputSampleRate.toLocaleString('de-DE') + ' Hz' : 'nicht gemeldet'],
      ['Kanäle (Mikrofon)', String(settings.channelCount || state.channels || 1)],
      ['Echounterdrückung', settings.echoCancellation ? 'vom Browser aktiv (sollte aus sein)' : 'aus'],
      ['Rauschunterdrückung', settings.noiseSuppression ? 'vom Browser aktiv (sollte aus sein)' : 'aus'],
      ['Automatische Verstärkung', settings.autoGainControl ? 'vom Browser aktiv (sollte aus sein)' : 'aus'],
      ['Verarbeitung', state.engineKind],
      ['Datenrate', 'ca. ' + formatBytes(state.sampleRate * 2) + '/s']
    ];

    el.techList.textContent = '';
    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      el.techList.appendChild(dt);
      el.techList.appendChild(dd);
    });

    var notes = [];
    if (state.sampleRate !== TARGET_RATE) {
      notes.push('Dieser Browser kann intern nur mit ' + state.sampleRate.toLocaleString('de-DE') +
        ' Hz arbeiten. Die WAV-Datei wird mit dieser Rate gespeichert.');
    }
    if (settings.echoCancellation || settings.noiseSuppression || settings.autoGainControl) {
      notes.push('Mindestens eine Browser-Verarbeitung ist aktiv. Deaktiviere sie zusätzlich in den Systemeinstellungen des Mikrofons für unverfälschte Aufnahmen.');
    }
    if (settings.sampleRate && settings.sampleRate !== TARGET_RATE) {
      notes.push('Das Mikrofon liefert ' + settings.sampleRate.toLocaleString('de-DE') + ' Hz; der Browser rechnet auf ' +
        state.sampleRate.toLocaleString('de-DE') + ' Hz um.');
    }

    if (notes.length) {
      el.techWarning.textContent = notes.join(' ');
      el.techWarning.hidden = false;
    } else {
      el.techWarning.hidden = true;
      el.techWarning.textContent = '';
    }
  }

  /* ── Geräteliste ────────────────────────────────────────────────────── */

  async function refreshDeviceList() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    var devices;
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch (err) {
      return;
    }
    var inputs = devices.filter(function (device) { return device.kind === 'audioinput'; });

    [el.deviceSelect, el.deviceSelectLive].forEach(function (select) {
      var previous = select.value;
      select.textContent = '';

      var fallback = document.createElement('option');
      fallback.value = '';
      fallback.textContent = inputs.length ? 'Standardmikrofon des Systems' : 'Kein Mikrofon gefunden';
      select.appendChild(fallback);

      inputs.forEach(function (device, index) {
        var option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || ('Mikrofon ' + (index + 1));
        select.appendChild(option);
      });

      var wanted = state.deviceId || previous;
      var exists = inputs.some(function (device) { return device.deviceId === wanted; });
      select.value = exists ? wanted : '';
    });

    if (state.track && state.track.label) {
      el.deviceHint.textContent = 'Aktiv: ' + state.track.label;
    }
  }

  async function switchDevice(deviceId) {
    state.deviceId = deviceId;
    if (isActive() || state.status === 'processing') return;
    inlineStatus('Mikrofon wird gewechselt …');
    teardownAudio();
    state.frames = 0;
    renderTimer();
    try {
      var stream = await requestMicrophone(deviceId || undefined);
      await setupAudio(stream);
    } catch (err) {
      console.error(err);
      showError(describeMicError(err));
      setStatus('idle');
      el.studio.hidden = true;
      el.gate.hidden = false;
    }
  }

  /* ── Aufnahme-Steuerung ─────────────────────────────────────────────── */

  async function startTake() {
    if (!state.engine || state.status === 'requesting' || state.status === 'processing') return;

    showError('');
    hideClipWarning();
    state.levels.clipTotal = 0;
    state.levels.lastClipAt = 0;
    state.frames = 0;
    state.stopping = false;
    state.take = { chunks: [], frames: 0 };

    try {
      await state.engine.start();
    } catch (err) {
      console.error(err);
      state.take = null;
      showError('Die Aufnahme konnte nicht gestartet werden: ' + (err && err.message ? err.message : 'unbekannter Fehler'));
      setStatus(state.engine ? 'ready' : 'idle');
      return;
    }

    setStatus('recording');
    startTimer();
    renderTimer();
    inlineStatus('Aufnahme läuft. Sprich ruhig und deutlich.');
  }

  function pauseTake() {
    if (state.status !== 'recording') return;
    state.engine.pause();
    setStatus('paused');
    renderTimer();
    inlineStatus('Pausiert. Mit Leertaste oder „Fortsetzen“ geht es weiter.');
  }

  function resumeTake() {
    if (state.status !== 'paused') return;
    state.engine.resume();
    setStatus('recording');
    renderTimer();
    inlineStatus('Aufnahme läuft weiter.');
  }

  async function finishTake(reason) {
    if (!isActive() || state.stopping) return;
    state.stopping = true;

    var take = state.take;
    var framesBefore = state.frames;
    setStatus('processing');
    stopTimer();

    var result = { frames: 0 };
    try {
      result = await state.engine.stop();
    } catch (err) {
      console.warn('Stoppen meldete einen Fehler:', err);
    }

    var frames = Math.max(result && result.frames ? result.frames : 0, framesBefore, take ? take.frames : 0);
    var chunks = take ? take.chunks : [];
    state.take = null;
    state.stopping = false;

    var sampleCount = chunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
    if (!frames) frames = sampleCount;
    if (!result || result.timeout) {
      // Audio-Thread antwortet nicht: Node neu aufbauen, damit der nächste Take sauber ist.
      try {
        state.engine.dispose();
        var engine = state.ctx.audioWorklet && typeof window.AudioWorkletNode === 'function'
          ? createWorkletEngine(state.ctx, state.sourceNode)
          : createScriptProcessorEngine(state.ctx, state.sourceNode);
        await engine.mount();
        state.engine = engine;
      } catch (err) {
        console.warn('Engine-Neuaufbau fehlgeschlagen:', err);
      }
    }

    if (!sampleCount || frames < state.sampleRate * 0.25) {
      setStatus('ready');
      state.frames = 0;
      renderTimer();
      inlineStatus('Aufnahme verworfen: Sie war kürzer als eine Viertelsekunde.');
      toast('Aufnahme war zu kurz und wurde nicht gespeichert.');
      return;
    }

    var saved = await saveTake(chunks, frames);
    state.frames = 0;
    setStatus('ready');
    renderTimer();
    inlineStatus(state.persist
      ? 'Take ' + saved.number + ' gespeichert (' + formatDuration(saved.durationSec, false) +
        '). Du kannst direkt den nächsten Take aufnehmen.'
      : 'Take ' + saved.number + ' liegt nur im Arbeitsspeicher – bitte jetzt herunterladen.');

    if (reason === 'limit') {
      toast('Maximale Aufnahmelänge von ' + Math.round(MAX_TAKE_SECONDS / 60) +
        ' Minuten erreicht. Der Take wurde gespeichert.');
    }
  }

  /* ── Takes speichern & anzeigen ─────────────────────────────────────── */

  async function saveTake(chunks, frames) {
    var createdAt = Date.now();
    var number = state.nextNumber;
    var blob = StimmenWav.encodeWav(chunks, state.sampleRate, 1);
    var take = {
      id: 'take-' + createdAt + '-' + number,
      number: number,
      createdAt: createdAt,
      durationSec: frames / state.sampleRate,
      sampleRate: state.sampleRate,
      channels: 1,
      bytes: blob.size,
      deviceLabel: state.deviceLabel || '',
      clipCount: state.levels.clipTotal,
      blob: blob
    };

    state.nextNumber = number + 1;
    state.takes.push(take);
    renderTakes();
    updateStorageHint();

    if (state.persist) {
      try {
        await StimmenDB.put(take);
      } catch (err) {
        console.error('IndexedDB-Speichern fehlgeschlagen:', err);
        state.persist = false;
        showStorageBanner('Der Browser konnte den Take nicht dauerhaft speichern (' +
          (err && err.message ? err.message : 'unbekannter Fehler') +
          '). Er bleibt nur bis zum Neuladen erhalten – lade ihn jetzt herunter.');
        toast('Take nur im Arbeitsspeicher – bitte jetzt herunterladen.', 'error');
      }
    }

    return take;
  }

  function urlForTake(take) {
    if (!state.urls[take.id]) {
      state.urls[take.id] = URL.createObjectURL(take.blob);
    }
    return state.urls[take.id];
  }

  function renderTakes() {
    el.takesList.textContent = '';

    state.takes.forEach(function (take) {
      var item = document.createElement('article');
      item.className = 'take';
      item.setAttribute('aria-labelledby', 'take-title-' + take.id);

      var head = document.createElement('div');
      head.className = 'take-head';

      var num = document.createElement('span');
      num.className = 'take-num';
      num.textContent = pad2(take.number);
      num.setAttribute('aria-hidden', 'true');

      var metaWrap = document.createElement('div');
      var title = document.createElement('h3');
      title.className = 'take-title';
      title.id = 'take-title-' + take.id;
      title.textContent = 'Take ' + pad2(take.number);

      var meta = document.createElement('p');
      meta.className = 'take-meta';
      var parts = [
        formatDuration(take.durationSec, false),
        (take.sampleRate || TARGET_RATE).toLocaleString('de-DE') + ' Hz',
        'Mono · 16 Bit',
        formatBytes(take.bytes),
        formatDate(take.createdAt)
      ];
      if (take.clipCount) parts.push('⚠ ' + take.clipCount + '× Übersteuerung');
      meta.textContent = parts.join(' · ');

      metaWrap.appendChild(title);
      metaWrap.appendChild(meta);
      head.appendChild(num);
      head.appendChild(metaWrap);

      var audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'none';
      audio.src = urlForTake(take);
      audio.setAttribute('aria-label', 'Wiedergabe von Take ' + pad2(take.number));

      var actions = document.createElement('div');
      actions.className = 'take-actions';

      var download = document.createElement('button');
      download.type = 'button';
      download.className = 'btn btn-primary';
      download.textContent = 'WAV herunterladen';
      download.addEventListener('click', function () { downloadTake(take); });

      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger';
      remove.textContent = 'Löschen';
      remove.setAttribute('aria-label', 'Take ' + pad2(take.number) + ' löschen');
      remove.addEventListener('click', function () { deleteTake(take, remove); });

      actions.appendChild(download);
      actions.appendChild(remove);

      item.appendChild(head);
      item.appendChild(audio);
      item.appendChild(actions);
      el.takesList.appendChild(item);
    });

    el.emptyState.hidden = state.takes.length > 0;
    updateSummary();
    updateControls();
  }

  function updateSummary() {
    var count = state.takes.length;
    if (!count) {
      el.takesSummary.textContent = 'Noch keine Aufnahme vorhanden.';
      return;
    }
    var totalSeconds = state.takes.reduce(function (sum, take) { return sum + take.durationSec; }, 0);
    var totalBytes = state.takes.reduce(function (sum, take) { return sum + (take.bytes || take.blob.size); }, 0);
    el.takesSummary.textContent = count + (count === 1 ? ' Aufnahme' : ' Aufnahmen') +
      ' · ' + formatDuration(totalSeconds, false) + ' gesamt · ' + formatBytes(totalBytes);
  }

  function downloadTake(take) {
    var blob = take.blob;
    triggerDownload(blob, takeFileName(take));
    inlineStatus('Take ' + pad2(take.number) + ' wird heruntergeladen: ' + takeFileName(take));
    toast('Download gestartet: ' + takeFileName(take));
  }

  async function deleteTake(take, button) {
    if (button) button.disabled = true;
    state.takes = state.takes.filter(function (item) { return item.id !== take.id; });

    if (state.urls[take.id]) {
      URL.revokeObjectURL(state.urls[take.id]);
      delete state.urls[take.id];
    }

    if (state.persist) {
      try {
        await StimmenDB.remove(take.id);
      } catch (err) {
        console.warn('Löschen aus IndexedDB fehlgeschlagen:', err);
        toast('Take aus der Liste entfernt, die Browser-Datenbank meldet aber einen Fehler.', 'error');
      }
    }

    renderTakes();
    updateStorageHint();
    toast('Take ' + pad2(take.number) + ' gelöscht.');
  }

  async function deleteAllTakes() {
    if (!state.takes.length) return;
    var confirmed = window.confirm('Alle ' + state.takes.length + ' Aufnahmen löschen? Bereits heruntergeladene Dateien bleiben auf deinem Gerät.');
    if (!confirmed) return;

    Object.keys(state.urls).forEach(function (id) { URL.revokeObjectURL(state.urls[id]); });
    state.urls = {};

    if (state.persist) {
      try { await StimmenDB.clear(); } catch (err) { console.warn(err); }
    }

    state.takes = [];
    state.nextNumber = 1;
    renderTakes();
    updateStorageHint();
    inlineStatus('Alle Aufnahmen gelöscht.');
    toast('Alle Aufnahmen gelöscht.');
  }

  /* ── ZIP-Export ─────────────────────────────────────────────────────── */

  function takeTextSummary() {
    var lines = [
      'StimmenClon Studio – Export',
      'Erstellt: ' + new Date().toLocaleString('de-DE'),
      '',
      'Format: mono, 48.000 Hz (bzw. wie unten angegeben), 16 Bit PCM-WAV, unkomprimiert.',
      'Keine Rauschunterdrückung, kein Echo, keine Sprachverbesserung, keine Effekte,',
      'keine automatische Lautstärkeveränderung.',
      '',
      'Die Aufnahmen bleiben auf diesem Gerät, bis du sie selbst herunterlädst oder löschst.',
      'Es erfolgt kein automatischer Upload.',
      '',
      'Verwende ausschließlich deine eigene Stimme oder eine Stimme, für deren Nutzung du',
      'eine ausdrückliche Einwilligung besitzt.',
      '',
      'Aufnahmen:'
    ];

    state.takes.forEach(function (take) {
      lines.push('  ' + takeFileName(take) +
        '  | Dauer ' + formatDuration(take.durationSec, false) +
        '  | ' + take.sampleRate + ' Hz' +
        '  | ' + formatBytes(take.bytes) +
        '  | aufgenommen ' + formatDate(take.createdAt) +
        (take.clipCount ? '  | Übersteuerung: ' + take.clipCount + '×' : ''));
    });

    lines.push('');
    lines.push('Gesamt: ' + state.takes.length + ' Takes, ' +
      formatDuration(state.takes.reduce(function (sum, take) { return sum + take.durationSec; }, 0), false) + '.');
    return lines.join('\n');
  }

  async function exportZip() {
    if (!state.takes.length || state.exporting) return;
    state.exporting = true;
    updateControls();
    el.exportZip.classList.add('is-busy');

    try {
      var entries = [];
      for (var i = 0; i < state.takes.length; i++) {
        var take = state.takes[i];
        el.exportStatus.textContent = 'Archiv wird vorbereitet … Take ' + (i + 1) + ' von ' + state.takes.length + ' („' + takeFileName(take) + '“)';
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
        entries.push({
          name: takeFileName(take),
          blob: take.blob,
          date: new Date(take.createdAt)
        });
      }

      el.exportStatus.textContent = 'ZIP-Datei wird geschrieben …';
      await new Promise(function (resolve) { setTimeout(resolve, 0); });

      entries.push({
        name: 'README.txt',
        data: new TextEncoder().encode(takeTextSummary()),
        date: new Date()
      });

      var zipBlob = await StimmenZip.create(entries);
      var name = 'stimmenclon-takes_' + fileStamp(new Date()) + '.zip';
      triggerDownload(zipBlob, name);
      el.exportStatus.textContent = 'Fertig: ' + name + ' (' + formatBytes(zipBlob.size) + ') mit ' + state.takes.length + ' Takes.';
      toast('ZIP-Export gestartet: ' + name);
    } catch (err) {
      console.error(err);
      el.exportStatus.textContent = 'Der ZIP-Export ist fehlgeschlagen. Versuche es mit weniger Takes oder exportiere sie einzeln.';
      toast('ZIP-Export fehlgeschlagen.', 'error');
    } finally {
      state.exporting = false;
      el.exportZip.classList.remove('is-busy');
      updateControls();
    }
  }

  function triggerDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
  }

  /* ── Speicher-Hinweise ──────────────────────────────────────────────── */

  function showStorageBanner(message) {
    el.storageBannerText.textContent = message;
    el.storageBanner.hidden = false;
  }

  async function updateStorageHint() {
    var estimate = await StimmenDB.estimate();
    if (!estimate || !estimate.quota) return;
    var usage = estimate.usage || 0;
    var percent = (usage / estimate.quota) * 100;
    if (percent > 85) {
      showStorageBanner('Der Browser-Speicher ist zu ' + percent.toFixed(0) +
        ' % belegt (' + formatBytes(usage) + ' von ' + formatBytes(estimate.quota) +
        '). Exportiere und lösche ältere Takes, bevor du weitere aufnimmst.');
    }
  }

  /* ── Start & Wiederherstellung ──────────────────────────────────────── */

  async function loadStoredTakes() {
    try {
      var stored = await StimmenDB.getAll();
      if (!stored.length) return;
      state.takes = stored.sort(function (a, b) { return a.number - b.number; });
      state.nextNumber = state.takes.reduce(function (max, take) {
        return Math.max(max, take.number || 0);
      }, 0) + 1;
      renderTakes();
      inlineStatus(state.takes.length + ' gespeicherte Takes aus diesem Browser wiederhergestellt.');
      updateStorageHint();
    } catch (err) {
      console.warn('Gespeicherte Takes konnten nicht geladen werden:', err);
      state.persist = false;
      showStorageBanner('Dieser Browser stellt keine lokale Datenbank bereit. Aufnahmen bleiben bis zum Neuladen der Seite im Arbeitsspeicher – lade sie vorher herunter.');
    }
  }

  function checkEnvironment() {
    var problems = [];
    if (!window.isSecureContext) {
      problems.push('Die Seite läuft nicht in einem sicheren Kontext. Öffne sie über http://localhost:8000 (Start über die README) – bei file:// blockiert der Browser das Mikrofon.');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      problems.push('Dieser Browser unterstützt getUserMedia nicht. Bitte Chrome, Edge, Firefox oder Safari in aktueller Version verwenden.');
    }
    if (problems.length) showError(problems.join(' '));
  }

  /* ── Ereignisse ─────────────────────────────────────────────────────── */

  el.enableMic.addEventListener('click', async function () {
    showError('');
    setStatus('requesting');
    el.enableMic.disabled = true;
    el.enableMic.classList.add('is-busy');
    try {
      var stream = await requestMicrophone(state.deviceId || undefined);
      await setupAudio(stream);
      toast('Mikrofon freigegeben. Du kannst jetzt aufnehmen.');
    } catch (err) {
      console.error(err);
      if (state.stream) {
        state.stream.getTracks().forEach(function (track) { track.stop(); });
        state.stream = null;
      }
      setStatus('idle');
      showError(describeMicError(err));
    } finally {
      el.enableMic.disabled = false;
      el.enableMic.classList.remove('is-busy');
    }
  });

  [el.deviceSelect, el.deviceSelectLive].forEach(function (select) {
    select.addEventListener('change', function () {
      state.deviceId = select.value;
      el.deviceSelect.value = select.value;
      el.deviceSelectLive.value = select.value;
      if (state.engine) switchDevice(select.value);
    });
  });

  el.recordButton.addEventListener('click', function () {
    if (isActive()) {
      finishTake('user');
    } else if (state.status === 'ready') {
      startTake();
    }
  });

  el.pauseButton.addEventListener('click', function () {
    if (state.status === 'recording') pauseTake();
    else if (state.status === 'paused') resumeTake();
  });

  el.stopButton.addEventListener('click', function () {
    if (isActive()) finishTake('user');
  });

  el.targetSelect.addEventListener('change', renderTimer);

  el.exportZip.addEventListener('click', exportZip);
  el.deleteAll.addEventListener('click', deleteAllTakes);

  scripts.forEach(function (button) {
    button.addEventListener('click', function () {
      var target = button.getAttribute('data-script');
      scripts.forEach(function (other) {
        var active = other === button;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-pressed', String(active));
      });
      el.scriptA.hidden = target !== 'a';
      el.scriptB.hidden = target !== 'b';
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    var target = event.target;
    var tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    var typing = tag === 'input' || tag === 'select' || tag === 'textarea' ||
      (target && target.isContentEditable) || tag === 'summary';

    if (typing) return;

    var key = event.key;

    if (key === 'r' || key === 'R') {
      event.preventDefault();
      if (isActive()) finishTake('user');
      else if (state.status === 'ready') startTake();
      return;
    }

    if (key === ' ' || key === 'Spacebar') {
      // Buttons und Details behalten ihr eigenes Tastaturverhalten.
      if (tag === 'button' || tag === 'a') return;
      if (state.status === 'recording' || state.status === 'paused') {
        event.preventDefault();
        if (state.status === 'recording') pauseTake();
        else resumeTake();
      }
      return;
    }

    if (key === 'Escape') {
      if (isActive()) {
        event.preventDefault();
        finishTake('user');
      }
    }
  });

  window.addEventListener('beforeunload', function (event) {
    if (isActive()) {
      event.preventDefault();
      event.returnValue = '';
      return '';
    }
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () {
      refreshDeviceList();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && state.engine && state.ctx && state.ctx.state === 'suspended') {
      state.ctx.resume().catch(function () { /* ignorieren */ });
    }
  });

  /* ── Initialisierung ────────────────────────────────────────────────── */

  function init() {
    checkEnvironment();
    renderTakes();
    renderTimer();
    updateControls();
    resetMeter();
    loadStoredTakes();

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then(function (status) {
        if (status.state === 'granted') {
          el.deviceHint.textContent = 'Der Browser hat den Zugriff bereits erlaubt – ein Klick genügt.';
        } else if (status.state === 'denied') {
          el.deviceHint.textContent = 'Der Zugriff ist derzeit blockiert. Erlaube ihn über das Schloss-Symbol in der Adressleiste.';
        }
      }).catch(function () { /* nicht in allen Browsern verfügbar */ });
    }

    refreshDeviceList();
  }

  init();
})();
