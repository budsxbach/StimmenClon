/* =========================================================================
   zip.js – minimaler ZIP-Writer (Methode "STORE", keine Kompression)
   WAV-Dateien lassen sich praktisch nicht sinnvoll komprimieren; STORE ist
   schnell, speicherschonend und erzeugt überall lesbare Archive.
   Abhängigkeitsfrei, damit die App komplett offline läuft.
   ========================================================================= */
(function (global) {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    var year = date.getFullYear();
    if (year < 1980) year = 1980;
    return {
      time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f),
      date: (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
    };
  }

  /**
   * @param {Array<{name:string, blob?:Blob, data?:Uint8Array, date?:Date}>} entries
   * @returns {Promise<Blob>} ZIP-Archiv
   */
  async function create(entries) {
    var encoder = new TextEncoder();
    var parts = [];
    var central = [];
    var offset = 0;

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var data = entry.data;
      if (!data && entry.blob) {
        data = new Uint8Array(await entry.blob.arrayBuffer());
      }
      if (!data) data = new Uint8Array(0);

      var nameBytes = encoder.encode(entry.name);
      var stamp = dosDateTime(entry.date || new Date());
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // lokales Header-Signal
      lv.setUint16(4, 20, true);           // benötigte Version
      lv.setUint16(6, 0x0800, true);       // UTF-8-Namen
      lv.setUint16(8, 0, true);            // Methode: STORE
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      parts.push(local, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);   // zentrales Header-Signal
      cv.setUint16(4, 20, true);           // erstellt von
      cv.setUint16(6, 20, true);           // benötigte Version
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);           // Extra
      cv.setUint16(32, 0, true);           // Kommentar
      cv.setUint16(34, 0, true);           // Disk
      cv.setUint16(36, 0, true);           // interne Attribute
      cv.setUint32(38, 0, true);           // externe Attribute
      cv.setUint32(42, offset, true);      // Offset des lokalen Headers
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + data.length;
    }

    var centralSize = 0;
    for (var j = 0; j < central.length; j++) centralSize += central[j].length;

    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(parts.concat(central, [eocd]), { type: 'application/zip' });
  }

  global.StimmenZip = { create: create, crc32: crc32 };
})(window);
