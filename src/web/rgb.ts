/**
 * Parse any CSS colour string into [r, g, b, a], each in 0–1 (sRGB, gamma-encoded).
 *
 * Supports:
 *   - Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
 *   - Named colours (all 148) + `transparent`
 *   - rgb() / rgba()   — legacy comma syntax and modern space syntax, numbers or %
 *   - hsl() / hsla()
 *   - hwb()
 *   - lab() / lch()     (CIE, D50)
 *   - oklab() / oklch()
 *   - color(<space> ...) for srgb, srgb-linear, display-p3, a98-rgb,
 *     prophoto-rgb, rec2020, xyz, xyz-d50, xyz-d65
 *   - `none` keyword, `/ alpha` as number or %, hue units deg/rad/grad/turn
 *
 * Wide-gamut / out-of-gamut colours are clipped to the sRGB cube.
 * Returns null for anything it can't parse (including context-dependent values
 * like `currentcolor`, system colours, color-mix(), and relative `from` syntax).
 */

export type RGBA = [r: number, g: number, b: number, a: number];

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

export function cssColorToRGBA(input: string): RGBA | null {
  const s = input.trim().toLowerCase();

  if (s === "transparent") {return [0, 0, 0, 0];}
  if (s.startsWith("#")) {return parseHex(s.slice(1));}

  const named = getNamedColors().get(s);
  if (named) {return parseHex(named);}

  const fnMatch = /^([a-z-]+)\(\s*([^()]*?)\s*\)$/.exec(s);
  if (!fnMatch) {return null;}
  const [, fn, body] = fnMatch;

  const args = splitArgs(body);
  if (!args) {return null;}
  let { channels, alpha } = args;

  let rgb: Vec3;

  switch (fn) {
    case "rgb":
    case "rgba": {
      if (channels.length !== 3) {return null;}
      rgb = channels.map((t) => pct(t, 255) / 255) as Vec3;
      break;
    }
    case "hsl":
    case "hsla": {
      if (channels.length !== 3) {return null;}
      rgb = hslToRgb(hue(channels[0]), pct(channels[1], 100) / 100, pct(channels[2], 100) / 100);
      break;
    }
    case "hwb": {
      if (channels.length !== 3) {return null;}
      rgb = hwbToRgb(hue(channels[0]), pct(channels[1], 100) / 100, pct(channels[2], 100) / 100);
      break;
    }
    case "lab": {
      if (channels.length !== 3) {return null;}
      rgb = labToSrgb(pct(channels[0], 100), pct(channels[1], 125), pct(channels[2], 125));
      break;
    }
    case "lch": {
      if (channels.length !== 3) {return null;}
      const [a, b] = polarToCartesian(pct(channels[1], 150), hue(channels[2]));
      rgb = labToSrgb(pct(channels[0], 100), a, b);
      break;
    }
    case "oklab": {
      if (channels.length !== 3) {return null;}
      rgb = oklabToSrgb(pct(channels[0], 1), pct(channels[1], 0.4), pct(channels[2], 0.4));
      break;
    }
    case "oklch": {
      if (channels.length !== 3) {return null;}
      const [a, b] = polarToCartesian(pct(channels[1], 0.4), hue(channels[2]));
      rgb = oklabToSrgb(pct(channels[0], 1), a, b);
      break;
    }
    case "color": {
      const space = channels.shift();
      if (!space || channels.length !== 3) {return null;}
      const convert = COLOR_SPACES[space];
      if (!convert) {return null;}
      rgb = convert(channels.map((t) => pct(t, 1)) as Vec3);
      break;
    }
    default:
      return null;
  }

  const a = alpha === undefined ? 1 : pct(alpha, 1);
  const out: RGBA = [rgb[0], rgb[1], rgb[2], a];
  if (out.some((v) => !Number.isFinite(v))) {return null;}
  return out.map(clamp01) as RGBA;
}

/* ------------------------------------------------------------------ */
/* Parsing helpers                                                     */
/* ------------------------------------------------------------------ */

function parseHex(hex: string): RGBA | null {
  if (!/^[0-9a-f]+$/.test(hex)) {return null;}
  let digits: string[];
  if (hex.length === 3 || hex.length === 4) {
    digits = [...hex].map((c) => c + c);
  } else if (hex.length === 6 || hex.length === 8) {
    digits = hex.match(/../g)!;
  } else {
    return null;
  }
  const v = digits.map((d) => parseInt(d, 16) / 255);
  return [v[0], v[1], v[2], v[3] ?? 1];
}

/** Splits function arguments into colour channels and an optional alpha token. */
function splitArgs(body: string): { channels: string[]; alpha?: string } | null {
  if (body.includes(",")) {
    // Legacy syntax: a, b, c[, alpha]
    if (body.includes("/")) {return null;}
    const parts = body.split(",").map((p) => p.trim());
    if (parts.some((p) => p === "" || /\s/.test(p))) {return null;}
    if (parts.length === 4) {return { channels: parts.slice(0, 3), alpha: parts[3] };}
    if (parts.length === 3) {return { channels: parts };}
    return null;
  }
  // Modern syntax: a b c [/ alpha]
  const slash = body.split("/");
  if (slash.length > 2) {return null;}
  const channels = slash[0].trim().split(/\s+/).filter(Boolean);
  const alpha = slash[1]?.trim();
  if (slash.length === 2 && (!alpha || /\s/.test(alpha))) {return null;}
  return { channels, alpha };
}

const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/;

function token(t: string): { n: number; unit: string } {
  if (t === "none") {return { n: 0, unit: "" };}
  const m = NUM_RE.exec(t);
  if (!m) {return { n: NaN, unit: "" };}
  return { n: parseFloat(m[1]), unit: m[2] };
}

/** Plain number as-is; percentage maps 100% -> `full`. */
function pct(t: string, full: number): number {
  const { n, unit } = token(t);
  if (unit === "") {return n;}
  if (unit === "%") {return (n / 100) * full;}
  return NaN;
}

/** Hue in degrees. */
function hue(t: string): number {
  const { n, unit } = token(t);
  switch (unit) {
    case "":
    case "deg":
      return n;
    case "rad":
      return (n * 180) / Math.PI;
    case "grad":
      return n * 0.9;
    case "turn":
      return n * 360;
    default:
      return NaN;
  }
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/* ------------------------------------------------------------------ */
/* Conversions                                                         */
/* ------------------------------------------------------------------ */

function hslToRgb(h: number, s: number, l: number): Vec3 {
  h = ((h % 360) + 360) % 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToRgb(h: number, w: number, b: number): Vec3 {
  if (w + b >= 1) {
    const g = w / (w + b);
    return [g, g, g];
  }
  return hslToRgb(h, 1, 0.5).map((c) => c * (1 - w - b) + w) as Vec3;
}

function polarToCartesian(c: number, hDeg: number): [number, number] {
  const r = (hDeg * Math.PI) / 180;
  return [c * Math.cos(r), c * Math.sin(r)];
}

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const signPow = (c: number, p: number) => Math.sign(c) * Math.abs(c) ** p;

// sRGB transfer functions (extended to negatives)
const srgbToLinear = (c: number) =>
  Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number) =>
  Math.abs(c) > 0.0031308 ? Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055) : 12.92 * c;

const XYZ_D65_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];

const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];

const LIN_P3_TO_XYZ: Mat3 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];

const LIN_A98_TO_XYZ: Mat3 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];

const LIN_PROPHOTO_TO_XYZ_D50: Mat3 = [
  [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
  [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
  [0, 0, 0.8251046025104601],
];

const LIN_REC2020_TO_XYZ: Mat3 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];

const xyzD65ToSrgb = (xyz: Vec3): Vec3 => mul(XYZ_D65_TO_LIN_SRGB, xyz).map(linearToSrgb) as Vec3;
const xyzD50ToSrgb = (xyz: Vec3): Vec3 => xyzD65ToSrgb(mul(D50_TO_D65, xyz));

function labToSrgb(L: number, a: number, b: number): Vec3 {
  const κ = 24389 / 27;
  const ε = 216 / 24389;
  const white: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
  const f1 = (L + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > ε ? f0 ** 3 : (116 * f0 - 16) / κ;
  const y = L > κ * ε ? f1 ** 3 : L / κ;
  const z = f2 ** 3 > ε ? f2 ** 3 : (116 * f2 - 16) / κ;
  return xyzD50ToSrgb([x * white[0], y * white[1], z * white[2]]);
}

function oklabToSrgb(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linearToSrgb) as Vec3;
}

const COLOR_SPACES: Record<string, (c: Vec3) => Vec3> = {
  srgb: (c) => c,
  "srgb-linear": (c) => c.map(linearToSrgb) as Vec3,
  "display-p3": (c) => xyzD65ToSrgb(mul(LIN_P3_TO_XYZ, c.map(srgbToLinear) as Vec3)),
  "a98-rgb": (c) => xyzD65ToSrgb(mul(LIN_A98_TO_XYZ, c.map((v) => signPow(v, 563 / 256)) as Vec3)),
  "prophoto-rgb": (c) =>
    xyzD50ToSrgb(
      mul(
        LIN_PROPHOTO_TO_XYZ_D50,
        c.map((v) => (Math.abs(v) <= 16 / 512 ? v / 16 : signPow(v, 1.8))) as Vec3,
      ),
    ),
  rec2020: (c) => {
    const α = 1.09929682680944;
    const β = 0.018053968510807;
    const lin = c.map((v) =>
      Math.abs(v) < β * 4.5 ? v / 4.5 : Math.sign(v) * ((Math.abs(v) + α - 1) / α) ** (1 / 0.45),
    ) as Vec3;
    return xyzD65ToSrgb(mul(LIN_REC2020_TO_XYZ, lin));
  },
  xyz: (c) => xyzD65ToSrgb(c),
  "xyz-d65": (c) => xyzD65ToSrgb(c),
  "xyz-d50": (c) => xyzD50ToSrgb(c),
};

/* ------------------------------------------------------------------ */
/* Named colours                                                       */
/* ------------------------------------------------------------------ */

let namedCache: Map<string, string> | undefined;

function getNamedColors(): Map<string, string> {
  if (namedCache) {return namedCache;}
  const raw =
    "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc " +
    "bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a " +
    "burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 " +
    "cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b " +
    "darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b " +
    "darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 " +
    "darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f " +
    "darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff " +
    "dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 " +
    "forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 " +
    "gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 " +
    "indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 " +
    "lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff " +
    "lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 " +
    "lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 " +
    "lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 " +
    "linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd " +
    "mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee " +
    "mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 " +
    "mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 " +
    "olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa " +
    "palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 " +
    "peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 " +
    "red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 " +
    "seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd " +
    "slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c " +
    "teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 " +
    "white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32";
  const parts = raw.split(" ");
  namedCache = new Map();
  for (let i = 0; i < parts.length; i += 2) {namedCache.set(parts[i], parts[i + 1]);}
  return namedCache;
}