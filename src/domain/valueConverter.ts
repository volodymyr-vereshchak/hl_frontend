/**
 * Utility functions for converting values between different formats
 * Replicates Python logic from data_proc.py: convert_int_to_hex_to_float
 */

/**
 * Convert integer to float using hex representation
 * Equivalent to Python: struct.unpack("!f", struct.pack("!i", value))[0]
 *
 * @param {number} intValue - Integer value to convert
 * @returns {number} - Float value
 */
export function convertIntToHexToFloat(intValue: number | null | undefined): number {
  if (intValue === null || intValue === undefined) {
    return 0;
  }

  // Convert integer to 32-bit signed integer (equivalent to struct.pack("!i", value))
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);

  // Write as big-endian signed 32-bit integer
  view.setInt32(0, intValue, false); // false = big-endian

  // Read as big-endian 32-bit float (equivalent to struct.unpack("!f", ...))
  const floatValue = view.getFloat32(0, false); // false = big-endian

  return floatValue;
}

/**
 * Convert array of integers to floats using hex representation
 *
 * @param {number[]} intArray - Array of integers to convert
 * @returns {number[]} - Array of float values
 */
export function convertIntArrayToFloatArray(intArray: number[]): number[] {
  if (!Array.isArray(intArray)) {
    return [];
  }

  return intArray.map(convertIntToHexToFloat);
}

// Computer (vychislitel) types whose edit-value byte layout we have actually
// verified. The decoders below (DST / INT16 / TEXT / HEX) are firmware-specific,
// so they are applied ONLY for these types; every other type keeps the generic
// numeric/float handling. Verified so far:
//   33 — "Флоутек-ТМ ГОСТ586" (Тернівка)
const VERIFIED_CALC_TYPE_IDS = new Set([33]);

// edit_type_ids that store time-of-day as seconds since midnight. 28/29 stay
// here as the generic fallback for unverified types; for verified types they
// are decoded as a DST rule instead (see DST_RULE_EDIT_TYPE_IDS).
const TIME_EDIT_TYPE_IDS = new Set([28, 29, 30, 31, 128]);

// edit_type_ids that store a DST switch rule, NOT a time-of-day. The device
// packs them as big-endian bytes [tag, hour, ruleConst, month]:
//   28 "Коли на літній час"  → 01 03 C9 03  → березень, 03:00
//   29 "Коли на зимовий час" → 01 04 C9 0A  → жовтень,  04:00
// The constant 0xC9 byte encodes the "last Sunday" rule (identical for both
// transitions), so there is no literal day/minute — only month + switch hour.
const DST_RULE_EDIT_TYPE_IDS = new Set([28, 29]);

// Ukrainian month names in genitive case (for "остання неділя <місяця>").
const UA_MONTHS_GENITIVE = [
  '', 'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
];

// edit_type_ids whose value is a small integer packed in a dword (high word is
// a 0x0102 type/len tag), so the real value is the low 16 bits. The old
// formatter mis-read these as floats and showed garbage like "2.39e-38".
//   32  Оперативний інтервал, хв.  → 01 02 00 1E → 30
//   131 Контрактна година         → 01 02 00 07 → 7
//   194 Порядок байтів (функц.6)   → 01 02 00 01 → 1
//   199 Адреса Обчислювача         → 01 02 00 57 → 87
const INT16_EDIT_TYPE_IDS = new Set([32, 131, 194, 199]);

// edit_type_ids whose 4 bytes are ASCII text (e.g. a pipeline-name fragment).
//   0  Найменування трубопроводу  → 20 20 20 20 → "    " (порожня назва)
const TEXT_EDIT_TYPE_IDS = new Set([0]);

// edit_type_ids that carry a packed event code (not a number/text/float), e.g.
//   15 "Змінені параметри доступу / Додано користувача" → 00 11 0D 02
// The field layout is unknown, so show the raw dword as hex for inspection.
const HEX_EDIT_TYPE_IDS = new Set([15]);

/**
 * Format a raw int from the edit archive into a human-readable string.
 *
 * Cases (in order):
 *  - |v| <= 32767 → enum/flag, display as integer (e.g. sensor type 0, 1, 2)
 *  - editTypeId in TIME_EDIT_TYPE_IDS → float is seconds → display as HH:MM:SS
 *  - |float| < 0.001 → coefficient, scientific notation (e.g. "1.6214e-5")
 *  - |float| >= 100000 → 2 decimal places
 *  - otherwise → 4 decimal places
 *
 * @param {number} rawInt      - Original integer value from DB
 * @param {number} editTypeId  - edit_type_id from the record (used for time detection)
 * @param {number} calcTypeId  - gas_volume_calc_type_id (computer type); gates
 *                               the firmware-specific decoders below
 * @returns {string}
 */
export function formatEditValue(
  rawInt: number | null | undefined,
  editTypeId: number | null = null,
  calcTypeId: number | null = null,
): string {
  if (rawInt === null || rawInt === undefined) return '—';

  // The decoders below (DST / HEX / INT16 / TEXT) are firmware-specific: their
  // byte layout has only been verified for VERIFIED_CALC_TYPE_IDS. For any
  // other computer type we skip them and use the generic numeric/float paths.
  const isVerified = VERIFIED_CALC_TYPE_IDS.has(calcTypeId as number);

  // DST switch rule (e.g. "Коли на літній/зимовий час"): decode the packed
  // big-endian bytes [tag, hour, ruleConst, month] into a readable rule.
  // Handled before the small-int / float paths because the raw value is a
  // packed dword, not a number.
  if (isVerified && DST_RULE_EDIT_TYPE_IDS.has(editTypeId as number)) {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setInt32(0, rawInt, false); // big-endian
    const hour = dv.getUint8(1);
    const month = dv.getUint8(3);
    const monthName = UA_MONTHS_GENITIVE[month];
    if (monthName && hour <= 23) {
      return `остання неділя ${monthName}, ${String(hour).padStart(2, '0')}:00`;
    }
    return String(rawInt); // unexpected packing → show raw
  }

  // Packed event code with unknown layout: show the raw dword as hex.
  if (isVerified && HEX_EDIT_TYPE_IDS.has(editTypeId as number)) {
    return '0x' + (rawInt >>> 0).toString(16).toUpperCase().padStart(8, '0');
  }

  // Small integer wrapped in a packed dword: the value is the low 16 bits.
  if (isVerified && INT16_EDIT_TYPE_IDS.has(editTypeId as number)) {
    return String(rawInt & 0xFFFF);
  }

  // 4-byte ASCII text: decode printable bytes, trim trailing spaces/nulls.
  if (isVerified && TEXT_EDIT_TYPE_IDS.has(editTypeId as number)) {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setInt32(0, rawInt, false); // big-endian
    let s = '';
    for (let i = 0; i < 4; i++) {
      const c = dv.getUint8(i);
      if (c === 0) continue;
      s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.';
    }
    s = s.replace(/\s+$/, '');
    return s.length ? s : '—';
  }

  if (rawInt >= -32767 && rawInt <= 32767) return String(rawInt);

  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt32(0, rawInt, false);
  const f = view.getFloat32(0, false);

  if (!isFinite(f) || isNaN(f)) return String(rawInt);

  // Time field: known edit_type_ids that store seconds since midnight → HH:MM:SS
  if (TIME_EDIT_TYPE_IDS.has(editTypeId as number)) {
    const totalSec = Math.round(Math.abs(f));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const abs = Math.abs(f);
  if (abs === 0) return '0';
  if (abs < 0.001) return f.toExponential(4);
  if (abs >= 100000) return f.toFixed(2);
  return f.toFixed(4);
}