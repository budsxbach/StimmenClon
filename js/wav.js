/* =========================================================================
   wav.js – WAV-Encoding (PCM, little endian)
   Erzeugt aus Int16- oder Float32-Blöcken eine unkomprimierte PCM-WAV-Datei.
   Keine Kompression, keine Normalisierung, keine Effekte.
   Die Audioblöcke werden ohne zusätzliche Kopie an den Blob gehängt, damit
   auch zehn Minuten und mehr ohne Speicherprobleme funktionieren.
   ========================================================================= */
(function (global) {
  'use strict';

  var LITTLE_ENDIAN = (function () {
    var probe = new Uint16Array([1]);
    return new Uint8Array(probe.buffer)[0] === 1;
  })();

  function writeAscii(view, offset, text) {
    for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function toInt16(value) {
    var s = value;
    if (s > 1) s = 1; else if (s < -1) s = -1;
    return s < 0 ? s * 32768 : s * 32767;
  }

  /**
   * @param {Array<Int16Array|Float32Array>} chunks  Audioblöcke (mono = 1 Kanal)
   * @param {number} sampleRate
   * @param {number} channels
   * @returns {Blob} audio/wav
   */
  function encodeWav(chunks, sampleRate, channels) {
    channels = channels || 1;

    var totalSamples = 0;
    var i, c;
    for (i = 0; i < chunks.length; i++) totalSamples += chunks[i].length;

    var frames = Math.floor(totalSamples / channels);
    var dataBytes = frames * channels * 2;

    var header = new ArrayBuffer(44);
    var view = new DataView(header);
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);                            // Größe fmt-Chunk
    view.setUint16(20, 1, true);                             // Format: PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);     // Byte-Rate
    view.setUint16(32, channels * 2, true);                  // Block-Align
    view.setUint16(34, 16, true);                            // 16 Bit pro Sample
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);

    var parts = [new Uint8Array(header)];

    var allInt16 = LITTLE_ENDIAN && chunks.every(function (chunk) {
      return chunk instanceof Int16Array &&
        chunk.byteOffset === 0 &&
        chunk.buffer.byteLength === chunk.byteLength;
    });

    if (allInt16) {
      for (i = 0; i < chunks.length; i++) {
        parts.push(new Uint8Array(chunks[i].buffer));
      }
    } else {
      var merged = new Int16Array(frames * channels);
      var offset = 0;
      for (i = 0; i < chunks.length; i++) {
        var chunk = chunks[i];
        if (chunk instanceof Int16Array) {
          merged.set(chunk, offset);
        } else {
          for (c = 0; c < chunk.length; c++) merged[offset + c] = toInt16(chunk[c]);
        }
        offset += chunk.length;
      }
      parts.push(new Uint8Array(merged.buffer));
    }

    return new Blob(parts, { type: 'audio/wav' });
  }

  /** Dauer in Sekunden aus der Sample-Anzahl. */
  function samplesToSeconds(samples, sampleRate) {
    return sampleRate > 0 ? samples / sampleRate : 0;
  }

  global.StimmenWav = {
    encodeWav: encodeWav,
    samplesToSeconds: samplesToSeconds
  };
})(window);
