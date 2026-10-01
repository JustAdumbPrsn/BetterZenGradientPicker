// ==UserScript==
// @name           BetterZenGradientPicker
// @version        2.0
// @description    A Sine mod which aims to overhaul Zen's gradient picker with tons of new features :))
// @author         JustAdumbPrsn
// @include        main
// ==/UserScript==

(function () {
  "use strict";

  const LOADED = Symbol.for("BetterZenGradientPicker.loaded");
  if (window[LOADED]) {
    return;
  }
  window[LOADED] = true;

  const { XPCOMUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/XPCOMUtils.sys.mjs"
  );

  const LEGACY_ROTATION_PREF_PREFIX = "zen.theme.rotation.";
  const LEGACY_FAVORITES_PREF = "zen.theme.picker.favorites";
  const FAVORITES_FILE = "zen-gradient-favorites.json";

  const MAX_DOTS = 6;
  const PICKER_PADDING = 30;
  const DOT_HALF_SIZE = 29;
  const PICKER_FALLBACK_WIDTH = 380;
  const MIN_VALID_RECT_SIZE = 80;

  const TOAST_MIN_HEIGHT = 42;
  const TOAST_SPACING = 8;
  const FAVORITES_PER_PAGE = 8;
  const FAVORITES_SAVE_DELAY_MS = 500;
  const ACCENT_THROTTLE_MS = 100;
  const ROOT_BACKGROUND_DEBOUNCE_MS = 250;
  const STARTUP_RETRY_MS = 500;
  const STARTUP_MAX_RETRIES = 20;

  // Lazy load preferences to avoid unnecessary early evaluation
  const lazy = {};
  XPCOMUtils.defineLazyPreferenceGetter(lazy, "gDynamicThemeSwitching", "zen.theme.dynamic-theme-switching", false);
  XPCOMUtils.defineLazyPreferenceGetter(lazy, "gTextLock", "zen.theme.text-lock", false);
  XPCOMUtils.defineLazyPreferenceGetter(lazy, "gLightnessInversion", "zen.theme.lightness-inversion", false);
  XPCOMUtils.defineLazyPreferenceGetter(lazy, "gAcrylicElements", "zen.theme.acrylic-elements", false);

  const OPACITY_EPSILON = 0.001;
  const DEFAULT_ROTATION = -45;
  const DIAL_CIRCUMFERENCE = 314.159;
  const DIAL_KNOB_RATIO = 0.32;
  const DIAL_CLICK_GUARD_MS = 200;
  const DIAL_ANIMATION_MS = 500;
  const DIAL_RING_THICKNESS_PX = 4;

  // Hook priority order (lower runs first)
  const HOOK_PRIORITY = {
    CORE: -100,
    HARMONY: 10,
    ROTATION: 20,
    OPACITY: 30,
    PALETTE: 40,
    DYNAMIC_THEME: 50,
    FAVORITES: 60,
  };

  // Extended color harmonies. Angles are geometric offsets from the primary dot.
  const EXTENDED_HARMONIES = [
    { type: "complementary", angles: [180] },
    { type: "singleAnalogous", angles: [330] },
    { type: "splitComplementary", angles: [150, 210] },
    { type: "triadic", angles: [120, 240] },
    { type: "analogous", angles: [30, 330] },
    { type: "polygonal4", angles: [90, 180, 270] },
    { type: "analogousLinear4", angles: [30, 330, 0] },
    { type: "floating", angles: [0, 0, 0] },
    { type: "polygonal5", angles: [72, 144, 216, 288] },
    { type: "analogous5", angles: [30, 60, 300, 330] },
    { type: "hybridAnalogous5", angles: [30, 330, 20, 340] },
    { type: "floating", angles: [0, 0, 0, 0] },
    { type: "polygonal6", angles: [60, 120, 180, 240, 300] },
    { type: "doubleAnalogous6", angles: [30, 330, 20, 340, 0] },
    { type: "floating", angles: [0, 0, 0, 0, 0] },
    { type: "linear", angles: [0] },
    { type: "linear", angles: [0, 0] },
    { type: "floating", angles: [] },
    { type: "floating", angles: [0] },
    { type: "floating", angles: [0, 0] },
  ];

  // Boundaries for hybrid modes where dots sit at different radii
  const HYBRID_HARMONIES = {
    analogousLinear4: { angles: [30, -30, 0], primaryRadiusCount: 2, minDots: 4 },
    hybridAnalogous5: { angles: [30, -30, 20, -20], primaryRadiusCount: 2, minDots: 5 },
    doubleAnalogous6: { angles: [30, -30, 20, -20, 0], primaryRadiusCount: 2, minDots: 6 },
  };

  // Pre-calculated paths for the opacity wave animation
  const WAVE_LINE_PATH = "M 51.373 27.395 L 367.037 27.395";
  const WAVE_SINE_PATH = "M 51.373 27.395 C 60.14 -8.503 68.906 -8.503 77.671 27.395 C 86.438 63.293 95.205 63.293 103.971 27.395 C 112.738 -8.503 121.504 -8.503 130.271 27.395 C 139.037 63.293 147.803 63.293 156.57 27.395 C 165.335 -8.503 174.101 -8.503 182.868 27.395 C 191.634 63.293 200.4 63.293 209.167 27.395 C 217.933 -8.503 226.7 -8.503 235.467 27.395 C 244.233 63.293 252.999 63.293 261.765 27.395 C 270.531 -8.503 279.297 -8.503 288.064 27.395 C 296.83 63.293 305.596 63.293 314.363 27.395 C 323.13 -8.503 331.896 -8.503 340.662 27.395 M 314.438 27.395 C 323.204 -8.503 331.97 -8.503 340.737 27.395 C 349.503 63.293 358.27 63.293 367.037 27.395";
  const WAVE_REFERENCE_Y = 27.395;
  const SVG_NS = "http://www.w3.org/2000/svg";

  // Helper to create namespaced SVG elements cleanly
  function createSVGElement(tag, attributes = {}, ...children) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.append(...children);
    return element;
  }

  // Normalizes rotation angles to a 0-359 range
  function toDisplayAngle(rotation) {
    return Math.round((((rotation - DEFAULT_ROTATION) % 360) + 360) % 360);
  }

  // Blob layouts for 4-6 dots
  // Each entry for dot N, walking clockwise
  const EXTRA_DOT_LAYOUTS = {
    4: [
      [0, 0, "10%", "85%"],
      [95, 0, "0%", "70%"],
      [100, 100, "0%", "65%"],
      [0, 100, "0%", "60%"],
    ],
    5: [
      [0, 0, "10%", "75%"],
      [95, 0, "0%", "62.5%"],
      [100, 72, "0%", "60%"],
      [50, 100, "0%", "60%"],
      [0, 72, "0%", "55%"],
    ],
    6: [
      [0, 0, "10%", "60%"],
      [95, 0, "0%", "60%"],
      [100, 50, "0%", "60%"],
      [100, 100, "0%", "65%"],
      [0, 100, "0%", "65%"],
      [0, 50, "0%", "50%"],
    ],
  };

  // Builds a multi-layer CSS gradient string, allowing global rotation
  function buildRotatedGradient(colors, delta, forToolbar) {
    const radians = (delta * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    
    // Rotate coordinate positions around the 50% center
    const rotate = (x, y) => {
      const rotatedX = cos * (x - 50) - sin * (y - 50) + 50;
      const rotatedY = sin * (x - 50) + cos * (y - 50) + 50;
      return `${Math.round(rotatedX)}% ${Math.round(rotatedY)}%`;
    };
    
    const glow = (x, y, color, innerStop, outerStop) =>
      `radial-gradient(circle at ${rotate(x, y)}, ${color} ${innerStop}, transparent ${outerStop})`;

    if (colors.length === 2) {
      const angle = -45 + delta;
      if (forToolbar) {
        return `linear-gradient(${angle}deg, ${colors[1]} 0%, ${colors[0]} 100%)`;
      }
      return [
        `linear-gradient(${angle + 180}deg, ${colors[0]} 0%, transparent 100%)`,
        `linear-gradient(${angle}deg, ${colors[1]} 0%, transparent 100%)`,
      ].join(", ");
    }

    const baseAngle = -5 + delta;
    const lastColor = colors[colors.length - 1];

    if (colors.length === 3) {
      return [
        `linear-gradient(${baseAngle}deg, ${colors[2]} 10%, transparent 80%)`,
        glow(95, 0, colors[1], "0%", "75%"),
        glow(0, 0, colors[0], "10%", "70%"),
      ].join(", ");
    }

    // 4-6 dots: one radial glow per dot, laid out by EXTRA_DOT_LAYOUTS.
    // CSS paints the first layer on top, so the last dot goes first.
    const layout = EXTRA_DOT_LAYOUTS[colors.length];
    if (!layout) {
      return colors.map((c, i) => `${c} ${(i / (colors.length - 1)) * 100}%`).join(", ");
    }
    return layout
      .map(([x, y, inner, outer], i) => glow(x, y, colors[i], inner, outer))
      .reverse()
      .join(", ");
  }

  let sinePoints = null;
  let lastWaveAmplitude = -1;
  let lastWavePath = "";

  // Parses SVG path into a cached array of coordinates to speed up animation frames
  function parseSinePath() {
    if (sinePoints) {
      return sinePoints;
    }
    sinePoints = [];
    for (const command of WAVE_SINE_PATH.match(/[MCL]\s*[\d\s.\-,]+/g) || []) {
      const type = command.charAt(0);
      const coords = command.slice(1).trim().split(/[\s,]+/).map(Number);
      if (type === "M") {
        sinePoints.push({ type, x: coords[0], dy: coords[1] - WAVE_REFERENCE_Y });
      } else if (type === "L") {
        sinePoints.push({ type, x: coords[0], y: coords[1] });
      } else {
        for (let i = 0; i < coords.length; i += 6) {
          sinePoints.push({
            type: "C",
            x1: coords[i],
            dy1: coords[i + 1] - WAVE_REFERENCE_Y,
            x2: coords[i + 2],
            dy2: coords[i + 3] - WAVE_REFERENCE_Y,
            x: coords[i + 4],
            dy: coords[i + 5] - WAVE_REFERENCE_Y,
          });
        }
      }
    }
    return sinePoints;
  }

  // Generates the wave's path string based on current amplitude
  function getWavePath(amplitude) {
    if (amplitude <= OPACITY_EPSILON) {
      return WAVE_LINE_PATH;
    }
    if (amplitude >= 1 - OPACITY_EPSILON) {
      return WAVE_SINE_PATH;
    }
    
    // Memoization check
    if (amplitude === lastWaveAmplitude) {
      return lastWavePath;
    }
    
    const y = WAVE_REFERENCE_Y;
    let path = "";
    for (const point of parseSinePath()) {
      if (point.type === "M") {
        path += `M ${point.x} ${y + point.dy * amplitude} `;
      } else if (point.type === "C") {
        path += `C ${point.x1} ${y + point.dy1 * amplitude} ${point.x2} ${y + point.dy2 * amplitude} ${point.x} ${y + point.dy * amplitude} `;
      } else {
        path += `L ${point.x} ${point.y} `;
      }
    }
    lastWaveAmplitude = amplitude;
    lastWavePath = path.trim();
    return lastWavePath;
  }

  const RANDOM_TEXTURE_STEPS = 16;
  const RANDOM_TEXTURE_MAX_STEP = 6;
  const RANDOM_OPACITY_MIN = 0.6;
  const OBSERVED_PREFS = [
    "zen.theme.dynamic-theme-switching",
    "zen.theme.text-lock",
    "zen.theme.lightness-inversion",
    "zen.view.window.scheme",
  ];
  
  // UI interaction timings
  const DYNAMIC_THEME_DELAY_MS = 80;
  const THEME_SWITCH_THROTTLE_MS = 150;
  const POST_DRAG_INVERSION_DELAY_MS = 180;
  const SCHEME_INVERT_DELAY_MS = 500;
  const SCHEME_REFRESH_DELAY_MS = 1000;
  const RECENT_INVERSION_WINDOW_MS = 1400;
  const INVERSION_COMMIT_DELAY_MS = 50;
  const INVERTING_RESET_DELAY_MS = 200;
  const CLICK_DRAG_TOLERANCE_PX = 3;
  const DRAG_START_THRESHOLD_PX = 5;
  const DRAG_LANDING_EASE = 0.3;
  const CLICK_SUPPRESSION_MS = 220;
  const DROP_CLICK_SUPPRESSION_MS = 320;
  const PAGE_HOVER_DELAY_MS = 500;
  const PRESET_CLICK_SETTLE_MS = 10;
  const FAVORITE_BUTTON_THROTTLE_MS = 100;
  const FAVORITE_BUTTON_SETTLE_MS = 250;
  const FAVORITE_SAVE_DELAY_MS = 700;
  const FAVORITE_RESTORE_MS = 800;

  // Heart animation constants
  const HEART_FPS = 60;
  const HEART_BOUNCE = 2.5;
  const HEART_PATH = "M11.9932 5.13581C9.9938 2.7984 6.65975 2.16964 4.15469 4.31001C1.64964 6.45038 1.29697 10.029 3.2642 12.5604C4.89982 14.6651 9.84977 19.1041 11.4721 20.5408C11.6536 20.7016 11.7444 20.7819 11.8502 20.8135C11.9426 20.8411 12.0437 20.8411 12.1361 20.8135C12.2419 20.7819 12.3327 20.7016 12.5142 20.5408C14.1365 19.1041 19.0865 14.6651 20.7221 12.5604C22.6893 10.029 22.3797 6.42787 19.8316 4.31001C17.2835 2.19216 13.9925 2.7984 11.9932 5.13581Z";
  const HEART_EASE_START = [0.416, 0.44, 0.667, 1];
  const HEART_EASE = [0.333, 0, 0.667, 1];
  
  const HEART_LIKE = {
    window: [17, 50],
    tracks: [
      ["outline", "transform", [[17, 100, HEART_EASE_START], [27.344, 85, null]]],
      ["outline", "opacity", [[17, 1, "hold"], [27, 0, null]]],
      [
        "filled",
        "transform",
        [[17, 100, HEART_EASE_START], [27.344, 85, HEART_EASE], [35, 107, HEART_EASE], [50, 100, null]],
      ],
      ["filled", "opacity", [[17, 0, "hold"], [22, 0, HEART_EASE], [26, 1, null]]],
    ],
  };
  
  const HEART_UNLIKE = {
    window: [109, 142],
    tracks: [
      [
        "filled",
        "transform",
        [[109, 100, HEART_EASE_START], [119.344, 85, null]],
      ],
      ["filled", "opacity", [[109, 1, "hold"], [115, 1, HEART_EASE], [119, 0, null]]],
      [
        "outline",
        "transform",
        [[109, 100, HEART_EASE_START], [119.344, 85, HEART_EASE], [127, 107, HEART_EASE], [142, 100, null]],
      ],
      ["outline", "opacity", [[109, 0, "hold"], [117, 0, HEART_EASE], [119, 1, null]]],
    ],
  };

  // Uses Web Animations API to animate the favorite heart smoothly
  function playHeartTrack(element, property, frames, [startFrame, endFrame]) {
    const span = endFrame - startFrame;
    const toValue = value => (property === "transform" ? `scale(${(1 + ((value - 100) / 100) * HEART_BOUNCE).toFixed(4)})` : value);
    const keyframes = frames.map(([frame, value, ease]) => ({
      offset: (frame - startFrame) / span,
      [property]: toValue(value),
      easing: ease === "hold" ? "steps(1, end)" : ease ? `cubic-bezier(${ease.join(", ")})` : "linear",
    }));
    if (keyframes[0].offset > 0) {
      keyframes.unshift({ ...keyframes[0], offset: 0, easing: "steps(1, end)" });
    }
    const last = keyframes[keyframes.length - 1];
    if (last.offset < 1) {
      keyframes.push({ ...last, offset: 1, easing: "linear" });
    }
    return element.animate(keyframes, { duration: (span / HEART_FPS) * 1000, fill: "forwards" });
  }

  const VALUE_ANIMATION_MS = 400;
  
  // Hardcoded geometry ensures thumbnails don't break if layout shifts
  const PREVIEW_GEOMETRY = {
    cx: (PICKER_FALLBACK_WIDTH + PICKER_PADDING * 2) / 2,
    cy: (PICKER_FALLBACK_WIDTH + PICKER_PADDING * 2) / 2,
    radius: (PICKER_FALLBACK_WIDTH + PICKER_PADDING) / 2,
    dotHalfSize: DOT_HALF_SIZE,
  };
  
  const PALETTE_UI_THROTTLE_MS = 120;
  const SLIDER_ANIMATION_MS = 400;
  const LIGHTNESS_GRADIENT_ID = "zen-picker-lightness-generator-gradient";

  const PALETTE_MODES = [
    { id: "full", label: "Full", toastLabel: "Full", type: undefined },
    { id: "pastel", label: "Pastel", toastLabel: "Pastel", type: "explicit-lightness", lightness: 85 },
    { id: "vibrant", label: "Vibrant", toastLabel: "Vibrant", type: "explicit-lightness", lightness: 50 },
    { id: "dark", label: "Dark", toastLabel: "Dark", type: "explicit-lightness", lightness: 25 },
    { id: "deep-dark", label: "Deep Dark", toastLabel: "Extra Dark", type: "explicit-lightness", lightness: 15 },
    { id: "bw", label: "B&W", toastLabel: "B&W", type: "explicit-black-white" },
  ];

  const RANDOM_HARMONIES_BY_COUNT = {
    2: ["complementary", "singleAnalogous", "linear"],
    3: ["splitComplementary", "triadic", "analogous", "linear"],
    4: ["polygonal4", "analogousLinear4"],
    5: ["polygonal5", "analogous5", "hybridAnalogous5"],
    6: ["polygonal6", "doubleAnalogous6"],
  };

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function pickRandom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  // Ensures dots aren't dragged outside the picker wheel
  function clampToCircle(position, center, radius) {
    const offsetX = (position?.x ?? center) - center;
    const offsetY = (position?.y ?? center) - center;
    const distance = Math.hypot(offsetX, offsetY);
    if (distance <= radius || distance === 0) {
      return {
        x: Math.max(0, Math.round(position?.x ?? center)),
        y: Math.max(0, Math.round(position?.y ?? center)),
      };
    }
    const scale = radius / distance;
    return { x: Math.round(center + offsetX * scale), y: Math.round(center + offsetY * scale) };
  }

  // Manually computes a dot color without needing DOM layout (useful for closed panels)
  function computeDotColor(picker, dot, { cx, cy, radius, dotHalfSize }, explicitLightness = 50) {
    const offsetX = dot.position.x + dotHalfSize - cx;
    const offsetY = dot.position.y + dotHalfSize - cy;
    const normalizedDistance = 1 - Math.min(Math.hypot(offsetX, offsetY) / radius, 1);
    const hue = ((Math.atan2(offsetY, offsetX) * 180) / Math.PI + 360) % 360;
    const isExplicitLightness = dot.type === "explicit-lightness";

    let saturation = isExplicitLightness ? normalizedDistance * 100 : 90 + (1 - normalizedDistance) * 10;
    if (dot.type === "explicit-black-white") {
      saturation = 0;
    }
    const lightness = isExplicitLightness ? explicitLightness : (1 - normalizedDistance) * 100;
    const rgb = picker.hslToRgb(hue / 360, saturation / 100, lightness / 100);
    return { rgb: rgb.map(value => Math.min(255, Math.max(0, value))), lightness };
  }

  function restoreAttribute(element, name, value) {
    if (value === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }

  // Task scheduler used heavily for throttling/debouncing UI interactions
  class nsZenPickerScheduler {
    #tasks = new Map();

    schedule(key, callback, delay = 80, { debounce = false } = {}) {
      const existing = this.#tasks.get(key);
      if (existing) {
        existing.callback = callback;
        if (!debounce) {
          return;
        }
        clearTimeout(existing.id);
      }
      const task = existing || { callback };
      task.id = setTimeout(() => {
        this.#tasks.delete(key);
        try {
          task.callback();
        } catch (e) {
        }
      }, delay);
      this.#tasks.set(key, task);
    }

    cancel(key) {
      const task = this.#tasks.get(key);
      if (task) {
        clearTimeout(task.id);
        this.#tasks.delete(key);
      }
    }

    cancelAll() {
      for (const task of this.#tasks.values()) {
        clearTimeout(task.id);
      }
      this.#tasks.clear();
    }
  }

  // Wraps native Zen picker functions to let our mod inject 'before' and 'after' logic cleanly
  class nsZenPickerHooks {
    #targets = new Map();

    install(owner, name) {
      const key = this.#key(owner, name);
      if (this.#targets.has(key) || typeof owner[name] !== "function") {
        return;
      }
      const entry = { owner, name, original: owner[name], before: [], after: [] };
      owner[name] = function (...args) {
        const ctx = { args, result: undefined, skip: false, self: this };
        const run = (hooks, phase) => {
          for (const { fn } of hooks) {
            try {
              fn(ctx);
            } catch (e) {
            }
          }
        };
        run(entry.before, "before");
        try {
          if (!ctx.skip) {
            ctx.result = entry.original.apply(this, ctx.args);
          }
        } finally {
          run(entry.after, "after");
        }
        return ctx.result;
      };
      this.#targets.set(key, entry);
    }

    add(owner, name, phase, fn, priority = 0) {
      this.install(owner, name);
      const list = this.#targets.get(this.#key(owner, name))?.[phase];
      if (!list) {
        return;
      }
      list.push({ fn, priority });
      list.sort((a, b) => a.priority - b.priority);
    }

    uninstall() {
      for (const { owner, name, original } of this.#targets.values()) {
        owner[name] = original;
      }
      this.#targets.clear();
    }

    #key(owner, name) {
      return `${typeof owner === "function" ? "static" : "instance"}:${name}`;
    }
  }

  // Handles saving/loading gradient rotation per-workspace instead of globally
  const nsZenPickerRotationStore = {
    get(aWorkspace) {
      const value = aWorkspace?.theme?.rotation;
      return Number.isFinite(value) ? value : undefined;
    },

    set(aWorkspace, angle) {
      if (aWorkspace?.theme) {
        aWorkspace.theme.rotation = Math.round(angle);
      }
    },

    // Move older configs from global preferences to individual workspaces
    migrateLegacyPrefs(workspaces) {
      try {
        const keys = Services.prefs.getChildList(LEGACY_ROTATION_PREF_PREFIX);
        if (!keys.length) {
          return;
        }
        for (const workspace of workspaces) {
          const key =
            LEGACY_ROTATION_PREF_PREFIX +
            String(workspace.uuid)
              .replace(/[{}]/g, "")
              .replace(/[^a-zA-Z0-9.-]/g, "_");
          if (!Services.prefs.prefHasUserValue(key)) {
            continue;
          }
          const angle = parseInt(Services.prefs.getCharPref(key), 10);
          if (Number.isFinite(angle) && workspace.theme && this.get(workspace) === undefined) {
            this.set(workspace, angle);
            window.gZenWorkspaces.saveWorkspace(workspace);
          }
        }
        for (const key of keys) {
          Services.prefs.clearUserPref(key);
        }
      } catch (e) {
      }
    },
  };

  const FAVORITES_VERSION = 2;
  const FAVORITES_QUARANTINE_MAX = 50;
  const FAVORITES_BACKUP_INTERVAL_MS = 60 * 60 * 1000;
  const PALETTE_EXPLICIT_LIGHTNESS = "explicit-lightness";
  const PALETTE_EXPLICIT_BLACK_WHITE = "explicit-black-white";
  const PALETTE_FULL = "undefined";

  const roundTo = (value, decimals) => {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  };
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const toFinite = (value, fallback) => {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const makeFavoriteId = () =>
    globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // Validates and standardizes a gradient's data structure
  function normalizeGradient(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.dots)) {
      return null;
    }
    const dots = [];
    for (const [index, dot] of raw.dots.entries()) {
      const x = toFinite(dot?.x, NaN);
      const y = toFinite(dot?.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }
      dots.push({ id: Math.round(toFinite(dot.id, index)), x: Math.round(x), y: Math.round(y) });
    }
    if (!dots.length || dots.length > MAX_DOTS) {
      return null;
    }
    dots.sort((a, b) => a.id - b.id);

    const numDots = dots.length;
    const paletteType =
      raw.paletteType === PALETTE_EXPLICIT_LIGHTNESS || raw.paletteType === PALETTE_EXPLICIT_BLACK_WHITE
        ? raw.paletteType
        : PALETTE_FULL;
    const lightness = clamp(toFinite(raw.lightness, 50), 0, 100);

    return {
      algo: numDots === 1 ? "floating" : String(raw.algo ?? ""),
      paletteType,
      lightness: paletteType === PALETTE_EXPLICIT_LIGHTNESS ? roundTo(lightness, 2) : Math.round(lightness),
      numDots,
      opacity: clamp(roundTo(toFinite(raw.opacity, 1), 3), 0, 1),
      texture: clamp(roundTo(toFinite(raw.texture, 0), 4), 0, 1),
      rotation: numDots > 1 ? Math.round(toFinite(raw.rotation, DEFAULT_ROTATION)) : null,
      dots,
    };
  }

  const fingerprintCache = new WeakMap();

  // Creates a unique string for a gradient state to detect duplicates
  function gradientFingerprint(aGradient) {
    let fingerprint = fingerprintCache.get(aGradient);
    if (fingerprint === undefined) {
      fingerprint = [
        aGradient.numDots,
        aGradient.algo,
        aGradient.paletteType,
        aGradient.paletteType === PALETTE_EXPLICIT_LIGHTNESS ? Math.round(aGradient.lightness) : "-",
        Math.round(aGradient.opacity * 100),
        Math.round(aGradient.texture * 100),
        aGradient.numDots > 1 ? aGradient.rotation : "-",
        aGradient.dots.map(dot => `${dot.id}:${dot.x},${dot.y}`).join(";"),
      ].join("|");
      fingerprintCache.set(aGradient, fingerprint);
    }
    return fingerprint;
  }

  // Handles reading/writing the favorites JSON file, including backups
  class _nsZenPickerFavoritesStore {
    #cache = [];
    #quarantine = [];
    #timer = null;
    #dirty = false;
    #readOnly = false;
    #queue = Promise.resolve();
    #backedUpThisSession = false;

    get path() {
      return PathUtils.join(PathUtils.profileDir, "chrome", FAVORITES_FILE);
    }

    get readOnly() {
      return this.#readOnly;
    }

    async load() {
      try {
        await this.#load();
      } catch (e) {
        this.#readOnly = true;
      }
    }

    async #load() {
      this.#cache = [];
      this.#quarantine = [];
      this.#readOnly = false;
      this.#dirty = false;

      let text = null;
      try {
        if (await IOUtils.exists(this.path)) {
          text = await IOUtils.readUTF8(this.path);
        }
      } catch (e) {
        this.#readOnly = true;
        return;
      }
      if (text === null) {
        await this.#migrateLegacyPref();
        return;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        await this.#setAside("not valid JSON");
        return;
      }

      let needsWrite = false;
      let list;
      let quarantine = [];
      if (Array.isArray(data)) {
        list = data;
        needsWrite = true;
        if (!(await this.#backupV1File())) {
          this.#readOnly = true;
        }
      } else if (data && typeof data === "object" && Array.isArray(data.favorites)) {
        list = data.favorites;
        quarantine = Array.isArray(data.quarantine) ? data.quarantine : [];
        if (Number(data.version) > FAVORITES_VERSION) {
          this.#readOnly = true;
        } else if (Number(data.version) !== FAVORITES_VERSION) {
          needsWrite = true;
        }
      } else {
        await this.#setAside("unrecognized format");
        return;
      }

      const changed = this.#ingest(list, quarantine);
      if ((needsWrite || changed) && !this.#readOnly) {
        await this.#writeNow();
      }
    }

    async #setAside(reason) {
      const dest = `${this.path}.corrupt-${Date.now()}.json`;
      try {
        await IOUtils.move(this.path, dest);
      } catch (e) {
        this.#readOnly = true;
      }
    }

    async #backupV1File() {
      const backup = PathUtils.join(PathUtils.profileDir, "chrome", "zen-gradient-favorites.v1.bak.json");
      try {
        if (!(await IOUtils.exists(backup))) {
          await IOUtils.copy(this.path, backup);
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    async #migrateLegacyPref() {
      try {
        if (!Services.prefs.prefHasUserValue(LEGACY_FAVORITES_PREF)) {
          return;
        }
        const data = JSON.parse(Services.prefs.getCharPref(LEGACY_FAVORITES_PREF));
        this.#ingest(Array.isArray(data) ? data : [], []);
        await this.#writeNow();
        Services.prefs.clearUserPref(LEGACY_FAVORITES_PREF);
      } catch (e) {
      }
    }

    #ingest(list, previousQuarantine) {
      const seenFingerprints = new Set();
      const seenIds = new Set();
      const entries = [];
      const quarantine = [...previousQuarantine];
      let changed = false;

      for (const item of list) {
        const gradient = normalizeGradient(item);
        if (!gradient) {
          quarantine.push({ reason: "invalid gradient", at: Date.now(), raw: item });
          changed = true;
          continue;
        }
        const fingerprint = gradientFingerprint(gradient);
        if (seenFingerprints.has(fingerprint)) {
          changed = true;
          continue;
        }
        seenFingerprints.add(fingerprint);

        let id = typeof item.id === "string" && item.id && !seenIds.has(item.id) ? item.id : null;
        if (!id) {
          id = makeFavoriteId();
          changed = true;
        }
        seenIds.add(id);
        entries.push({ id, createdAt: toFinite(item.createdAt, null), ...gradient });
      }

      this.#cache = entries;
      this.#quarantine = quarantine.slice(-FAVORITES_QUARANTINE_MAX);
      return changed;
    }

    get() {
      return this.#cache;
    }

    add(aGradient) {
      const entry = { id: makeFavoriteId(), createdAt: Date.now(), ...aGradient };
      this.#cache = [entry, ...this.#cache];
      this.#scheduleWrite();
      return entry;
    }

    removeByIds(ids) {
      const remove = new Set(ids);
      const next = this.#cache.filter(entry => !remove.has(entry.id));
      if (next.length === this.#cache.length) {
        return false;
      }
      this.#cache = next;
      this.#scheduleWrite();
      return true;
    }

    setOrder(favorites) {
      this.#cache = favorites;
      this.#scheduleWrite();
    }

    #scheduleWrite() {
      this.#dirty = true;
      clearTimeout(this.#timer);
      this.#timer = setTimeout(() => this.#writeNow(), FAVORITES_SAVE_DELAY_MS);
    }

    flush() {
      clearTimeout(this.#timer);
      return this.#dirty ? this.#writeNow() : this.#queue;
    }

    #serialize() {
      const rows = this.#cache.map(entry => ` ${JSON.stringify(entry)}`).join(",\n");
      return (
        `{"version":${FAVORITES_VERSION},"favorites":[${rows ? `\n${rows}\n` : ""}],` +
        `"quarantine":${JSON.stringify(this.#quarantine)}}\n`
      );
    }

    #writeNow() {
      clearTimeout(this.#timer);
      if (this.#readOnly) {
        return this.#queue;
      }
      this.#dirty = false;
      const text = this.#serialize();
      this.#queue = this.#queue.then(() => this.#write(text));
      return this.#queue;
    }

    async #write(text) {
      try {
        await this.#refreshBackup();
        await IOUtils.writeUTF8(this.path, text, { tmpPath: `${this.path}.tmp` });
      } catch (e) {
        this.#dirty = true;
      }
    }

    async #refreshBackup() {
      const backup = `${this.path}.bak`;
      try {
        if (!(await IOUtils.exists(this.path))) {
          return;
        }
        let stale = !this.#backedUpThisSession || !(await IOUtils.exists(backup));
        if (!stale) {
          const { lastModified } = await IOUtils.stat(backup);
          stale = Date.now() - lastModified > FAVORITES_BACKUP_INTERVAL_MS;
        }
        if (stale) {
          await IOUtils.copy(this.path, backup);
          this.#backedUpThisSession = true;
        }
      } catch (e) {
      }
    }
  }
  const nsZenPickerFavoritesStore = new _nsZenPickerFavoritesStore();

  // Base class for mod features to handle their own lifecycle and event unbinding
  class nsZenPickerFeature {
    #abort = new AbortController();

    constructor(mods) {
      this.mods = mods;
    }

    get signal() {
      return this.#abort.signal;
    }

    init(picker) {
      this.picker = picker;
    }

    uninit() {
      this.#abort.abort();
    }

    listen(target, type, handler, options = {}) {
      target?.addEventListener(type, handler, { ...options, signal: this.signal });
    }
  }

  // Modifies opacity slider to allow full 0-1 values and keeps the background/UI wave in sync
  class nsZenPickerOpacity extends nsZenPickerFeature {
    #rafId = 0;
    #lastOpacity = -1;
    #lastTransparentState = null;
    isAnimating = false;

    init(picker) {
      super.init(picker);
      this.mods.opacityFeature = this;

      ChromeUtils.defineLazyGetter(this, "slider", () =>
        document.getElementById("PanelUI-zen-gradient-generator-opacity")
      );
      ChromeUtils.defineLazyGetter(this, "wavePath", () =>
        document.querySelector("#PanelUI-zen-gradient-slider-wave svg path")
      );
      ChromeUtils.defineLazyGetter(this, "waveStops", () =>
        document.querySelectorAll("#PanelUI-zen-gradient-generator-slider-wave-gradient stop")
      );

      if (this.slider) {
        this.slider.min = "0";
        this.slider.max = "1";
        this.slider.step = "0.001";
        this.slider.value = picker.currentOpacity;
        this.listen(this.slider, "input", event =>
          this.#scheduleVisualUpdate(parseFloat(event.target.value))
        );
      }

      // Intercept blend logic to allow standard CSS transparency
      this.mods.hooks.add(
        picker,
        "blendWithWhiteOverlay",
        "before",
        ctx => {
          const [color, opacity] = ctx.args;
          ctx.result = `rgba(${color[0]},${color[1]},${color[2]},${opacity})`;
          ctx.skip = true;
        },
        HOOK_PRIORITY.OPACITY
      );

      this.mods.hooks.add(
        picker,
        "onWorkspaceChange",
        "before",
        ctx => {
          if (this.isAnimating) {
            ctx.savedOpacity = picker.currentOpacity;
          }
        },
        HOOK_PRIORITY.OPACITY
      );

      this.mods.hooks.add(
        picker,
        "onWorkspaceChange",
        "after",
        ctx => {
          if (this.isAnimating) {
            if (ctx.savedOpacity !== undefined) {
              picker.currentOpacity = ctx.savedOpacity;
            }
            this.performVisualUpdate(picker.currentOpacity);
            return;
          }
          this.#lastOpacity = picker.currentOpacity;
          this.performVisualUpdate(this.#lastOpacity);
        },
        HOOK_PRIORITY.OPACITY
      );

      this.#scheduleVisualUpdate(picker.currentOpacity);
    }

    uninit() {
      this.isAnimating = false;
      this.mods.opacityFeature = null;
      cancelAnimationFrame(this.#rafId);
      super.uninit();
    }

    #scheduleVisualUpdate(opacity) {
      if (Math.abs(opacity - this.#lastOpacity) < OPACITY_EPSILON) {
        return;
      }
      this.#lastOpacity = opacity;
      if (this.#rafId) {
        return;
      }
      this.#rafId = requestAnimationFrame(() => {
        this.#rafId = 0;
        this.performVisualUpdate(this.#lastOpacity);
      });
    }

    performVisualUpdate(opacity) {
      this.#lastOpacity = opacity;
      this.#toggleTransparentBackground(opacity <= OPACITY_EPSILON);
      const { slider, wavePath, waveStops } = this;
      if (!slider) {
        return;
      }
      slider.value = opacity;

      const thumbHeight = `${40 + opacity * 15}px`;
      const thumbWidth = `${10 + opacity * 15}px`;
      if (slider.style.getPropertyValue("--zen-thumb-height") !== thumbHeight) {
        slider.style.setProperty("--zen-thumb-height", thumbHeight);
      }
      if (slider.style.getPropertyValue("--zen-thumb-width") !== thumbWidth) {
        slider.style.setProperty("--zen-thumb-width", thumbWidth);
      }

      if (waveStops?.length >= 3) {
        const offset = `${Math.min(opacity * 100 + 3, 100)}%`;
        if (waveStops[1].getAttribute("offset") !== offset) {
          waveStops[1].setAttribute("offset", offset);
          waveStops[2].setAttribute("offset", offset);
        }
      }

      if (wavePath) {
        const path = getWavePath(opacity);
        if (wavePath.getAttribute("d") !== path) {
          wavePath.setAttribute("d", path);
        }
        wavePath.style.stroke =
          opacity <= OPACITY_EPSILON
            ? waveStops?.[2]?.getAttribute("stop-color") || "currentColor"
            : "url(#PanelUI-zen-gradient-generator-slider-wave-gradient)";
      }
    }

    #toggleTransparentBackground(isTransparent) {
      const state = isTransparent ? "transparent" : "opaque";
      if (this.#lastTransparentState === state) {
        return;
      }
      this.#lastTransparentState = state;
      const root = document.documentElement;
      if (isTransparent) {
        root.style.setProperty("--zen-main-browser-background", "transparent", "important");
        root.style.setProperty("--zen-main-browser-background-toolbar", "transparent", "important");
      } else if (root.style.getPropertyValue("--zen-main-browser-background") === "transparent") {
        root.style.removeProperty("--zen-main-browser-background");
        root.style.removeProperty("--zen-main-browser-background-toolbar");
      }
    }
  }

  // Manages custom harmony rules like "floating" dots and multi-dot layouts
  class nsZenPickerHarmony extends nsZenPickerFeature {
    #floatingActive = false;
    #pendingMove = null;
    #moveRaf = 0;
    #flushingMove = false;
    #originalHarmonies = null;

    init(picker) {
      super.init(picker);
      const { hooks } = this.mods;

      this.#originalHarmonies = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(picker),
        "colorHarmonies"
      );
      Object.defineProperty(picker, "colorHarmonies", {
        get: () => EXTENDED_HARMONIES,
        configurable: true,
      });

      hooks.add(picker, "handleColorPositions", "before", ctx => this.#purgeOrphanDots(ctx), HOOK_PRIORITY.HARMONY);
      hooks.add(picker, "calculateCompliments", "before", ctx => this.#calculateCompliments(ctx), HOOK_PRIORITY.HARMONY);
      hooks.add(picker, "getGradient", "after", ctx => this.#syncFromGradient(ctx), HOOK_PRIORITY.HARMONY);
      hooks.add(picker, "onDotMouseMove", "before", ctx => this.#coalesceMove(ctx), HOOK_PRIORITY.HARMONY);
      hooks.add(picker, "onDotMouseUp", "before", () => this.#flushMove(), HOOK_PRIORITY.HARMONY);

      this.listen(picker.panel, "popupshowing", () => this.#syncFromWorkspace());
      this.listen(this.mods.events, "harmony-mode", event => {
        picker.useAlgo = event.detail.algorithm;
        this.#setHarmonyMode(event.detail.algorithm);
      });
    }

    uninit() {
      cancelAnimationFrame(this.#moveRaf);
      if (this.#originalHarmonies) {
        Object.defineProperty(this.picker, "colorHarmonies", this.#originalHarmonies);
      } else {
        delete this.picker.colorHarmonies;
      }
      super.uninit();
    }

    #setHarmonyMode(algorithm) {
      const isFloating = algorithm === "floating";
      this.#floatingActive = isFloating;
      if (isFloating) {
        this.picker.panel.setAttribute("zen-harmony-mode", "floating");
      } else {
        this.picker.panel.removeAttribute("zen-harmony-mode");
      }
    }

    #syncFromWorkspace() {
      const colors = this.mods.getWorkspace()?.theme?.gradientColors;
      const algorithm = colors?.[0]?.algorithm;
      if (!Array.isArray(colors) || colors.length < 2 || !algorithm) {
        return;
      }
      this.picker.useAlgo = algorithm;
      this.#setHarmonyMode(algorithm);
    }

    #syncFromGradient(ctx) {
      if (this.mods.renderingWorkspaceId) {
        return;
      }
      const themedColors = ctx.self.themedColors(ctx.args[0]);
      const algorithm = themedColors[0]?.algorithm ?? "";
      if (themedColors.length > 1 && algorithm) {
        ctx.self.useAlgo = algorithm;
        this.#setHarmonyMode(algorithm);
      }
    }

    #purgeOrphanDots(ctx) {
      const targetIds = new Set(ctx.args[0].map(position => position.ID));
      const picker = ctx.self;
      picker.dots = picker.dots.filter(dot => {
        if (targetIds.has(dot.ID)) {
          return true;
        }
        dot.element?.remove();
        return false;
      });
    }

    #coalesceMove(ctx) {
      const picker = ctx.self;
      if (this.#flushingMove || !picker.dragging) {
        return;
      }
      const [event] = ctx.args;
      event.preventDefault();
      this.#pendingMove = event;
      ctx.skip = true;
      if (!this.#moveRaf) {
        this.#moveRaf = requestAnimationFrame(() => {
          this.#moveRaf = 0;
          this.#flushMove();
        });
      }
    }

    #flushMove() {
      if (this.#moveRaf) {
        cancelAnimationFrame(this.#moveRaf);
        this.#moveRaf = 0;
      }
      const event = this.#pendingMove;
      this.#pendingMove = null;
      if (!event || !this.picker.dragging) {
        return;
      }
      this.#flushingMove = true;
      try {
        this.picker.onDotMouseMove(event);
      } finally {
        this.#flushingMove = false;
      }
    }

    #getRadiusBlend(primaryRadius, maxRadius) {
      if (primaryRadius < maxRadius * 0.3) {
        return 1;
      }
      if (primaryRadius > maxRadius * 0.5) {
        return 0;
      }
      return 1 - (primaryRadius - maxRadius * 0.3) / (maxRadius * 0.2);
    }

    #calculateCompliments(ctx) {
      const picker = ctx.self;
      const [dots, action = "update", useHarmony = ""] = ctx.args;
      const { width, height } = this.mods.getGradientSize();
      const center = { x: width / 2, y: height / 2 };

      if (action === "add" || action === "remove") {
        const targetAngleCount = Math.max(0, dots.length + (action === "add" ? 1 : 0) - 1);
        const nextHarmony = picker.colorHarmonies.find(h => h.angles.length === targetAngleCount);
        if (nextHarmony?.type === "floating" || nextHarmony?.type === "linear") {
          picker.useAlgo = nextHarmony.type;
          const result = [...dots];
          if (action === "add") {
            const primary = dots.find(dot => dot.ID === 0) || dots[0];
            result.push({
              ID: dots.length,
              position: center,
              type: primary?.type || "explicit-lightness",
            });
          }
          ctx.result = result;
          ctx.skip = true;
          return;
        }
        ctx.args[2] = "";
        return;
      }

      const activeAlgorithm = useHarmony || picker.useAlgo || "";

      if (activeAlgorithm === "floating") {
        picker.useAlgo = "floating";
        const justEntered =
          action === "harmony" ||
          (action === "update" && useHarmony === "floating" && !this.#floatingActive);
        this.#setHarmonyMode("floating");
        if (justEntered && !picker.dragging) {
          setTimeout(() => this.#wiggleDots(dots), 50);
        }
        ctx.result = dots;
        ctx.skip = true;
        return;
      }
      this.#setHarmonyMode(activeAlgorithm);

      const primary = dots.find(dot => dot.ID === 0) || dots[0];
      const secondary = dots.filter(dot => dot.ID !== 0).sort((a, b) => a.ID - b.ID);
      const maxRadius = width / 2;

      // Handle custom hybrid harmonies
      if (HYBRID_HARMONIES[activeAlgorithm] && primary) {
        const config = HYBRID_HARMONIES[activeAlgorithm];
        picker.useAlgo = activeAlgorithm;
        if (dots.length >= config.minDots) {
          const offsetX = primary.position.x - center.x;
          const offsetY = primary.position.y - center.y;
          const baseAngle = Math.atan2(offsetY, offsetX);
          const primaryRadius = Math.hypot(offsetX, offsetY);
          const blend = this.#getRadiusBlend(primaryRadius, maxRadius);
          const secondaryRadius =
            (primaryRadius / 2) * (1 - blend) +
            (primaryRadius + (maxRadius - primaryRadius) / 2) * blend;

          ctx.result = dots.map(dot => {
            const index = secondary.indexOf(dot);
            if (dot.ID === 0 || index < 0 || index >= config.angles.length) {
              return dot;
            }
            const angle = baseAngle + (config.angles[index] * Math.PI) / 180;
            const radius = index < config.primaryRadiusCount ? primaryRadius : secondaryRadius;
            return {
              ...dot,
              position: {
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle),
              },
            };
          });
          ctx.skip = true;
          return;
        }
      }

      if (activeAlgorithm === "linear" && primary && dots.length >= 2 && dots.length <= MAX_DOTS) {
        picker.useAlgo = "linear";
        const offsetX = primary.position.x - center.x;
        const offsetY = primary.position.y - center.y;
        const primaryAngle = Math.atan2(offsetY, offsetX);
        const primaryRadius = Math.hypot(offsetX, offsetY);
        const blend = this.#getRadiusBlend(primaryRadius, maxRadius);
        const step = secondary.length + 1;

        ctx.result = dots.map(dot => {
          const index = secondary.indexOf(dot);
          if (dot.ID === 0 || index < 0) {
            return dot;
          }
          const targetRadius =
            ((primaryRadius / step) * (index + 1)) * (1 - blend) +
            (primaryRadius + ((maxRadius - primaryRadius) / step) * (index + 1)) * blend;
          return {
            ...dot,
            position: {
              x: center.x + targetRadius * Math.cos(primaryAngle),
              y: center.y + targetRadius * Math.sin(primaryAngle),
            },
          };
        });
        ctx.skip = true;
        return;
      }

      ctx.args[2] = activeAlgorithm;
    }

    #wiggleDots(dots) {
      const { width, height } = this.mods.getGradientSize();
      for (const dot of dots) {
        const element = dot.element;
        if (!element?.isConnected) {
          continue;
        }
        element.style.setProperty("--ox", `${width / 2 - dot.position.x}px`);
        element.style.setProperty("--oy", `${height / 2 - dot.position.y}px`);
        element.classList.remove("zen-dot-shake");
        void element.offsetWidth; // Restart the animation.
        element.classList.add("zen-dot-shake");
        setTimeout(() => element.classList.remove("zen-dot-shake"), 650);
      }
    }
  }

  // Adds a rotation dial to control the entire gradient's angle per workspace
  class nsZenPickerRotation extends nsZenPickerFeature {
    #currentRotation = DEFAULT_ROTATION;
    #updating = false;
    #dragging = false;
    #lastDragEnd = 0;
    #dialBounds = null;
    #pendingRotation = null;
    #dragRaf = 0;
    #lastUIKey = null;
    #lastDisabled = null;

    get displayAngle() {
      return toDisplayAngle(this.#currentRotation);
    }

    init(picker) {
      super.init(picker);
      const { hooks, events } = this.mods;
      const priority = HOOK_PRIORITY.ROTATION;

      this.#buildDial();

      hooks.add(picker, "updateCurrentWorkspace", "before", () => (this.#updating = true), priority);
      hooks.add(picker, "updateCurrentWorkspace", "after", () => (this.#updating = false), priority);
      hooks.add(
        picker.constructor,
        "getTheme",
        "after",
        ctx => {
          if (this.#updating) {
            ctx.result.rotation = this.#currentRotation;
          }
        },
        priority
      );

      hooks.add(
        picker,
        "onWorkspaceChange",
        "before",
        ctx => {
          if (!this.mods.isInteracting()) {
            this.#restoreRotation(ctx.args[0]);
          }
        },
        priority
      );
      hooks.add(
        picker,
        "onWorkspaceChange",
        "after",
        () => {
          if (!this.mods.isInteracting()) {
            this.#updateUI();
          }
        },
        priority
      );
      hooks.add(picker, "initThemePicker", "before", () => this.#restoreRotation(), priority);
      hooks.add(picker, "initThemePicker", "after", () => this.#updateUI(), priority);
      hooks.add(picker, "getGradient", "after", ctx => this.#rotateGradient(ctx), priority);

      this.listen(picker.panel, "popupshowing", () => this.#restoreRotation());
      this.listen(events, "set-rotation", event => {
        this.#setRotation(event.detail.rotation, { animate: true });
        this.#commit(event.detail.save ?? false);
      });

      ChromeUtils.idleDispatch(() => {
        this.#restoreRotation();
        if (picker.panel.querySelector(".zen-theme-picker-dot")) {
          picker.updateCurrentWorkspace();
        }
      });
    }

    #buildDial() {
      const textureWrapper = document.getElementById("PanelUI-zen-gradient-generator-texture-wrapper");
      const row = this.mods.getSecondaryRow();
      if (!textureWrapper || !row) {
        return;
      }

      const ringCircle = createSVGElement("circle", { cx: 50, cy: 50, r: 50 });
      const arcCircle = createSVGElement("circle", {
        cx: 50,
        cy: 50,
        r: 50,
        "stroke-dasharray": `0 ${DIAL_CIRCUMFERENCE}`,
      });

      const dialRing = createSVGElement("svg", { id: "zen-rotation-dial-ring", viewBox: "0 0 100 100" }, ringCircle);
      const dialArc = createSVGElement("svg", { id: "zen-rotation-dial-arc", viewBox: "0 0 100 100" }, arcCircle);

      const labelText = document.createElement("span");
      labelText.textContent = "0°";
      const label = document.createElement("div");
      label.id = "zen-rotation-dial-label";
      label.append(labelText);

      const handle = document.createElement("div");
      handle.id = "zen-rotation-dial-handler";
      handle.classList.add("no-squircles");
      const handleContainer = document.createElement("div");
      handleContainer.id = "zen-rotation-dial-handler-container";
      handleContainer.append(handle);

      const dial = document.createElement("div");
      dial.id = "zen-rotation-dial-wrapper";
      dial.classList.add("no-squircles");
      dial.append(dialRing, dialArc, label, handleContainer);

      const wrapper = document.createXULElement("vbox");
      wrapper.id = "zen-picker-rotation-wrapper";
      wrapper.append(dial);
      row.append(wrapper);

      this.dial = { wrapper, dial, ringCircle, arcCircle, dialArc, label, labelText, handleContainer };
      this.#syncRingThickness();
      this.listen(this.picker.panel, "popupshowing", () => this.#syncRingThickness());

      this.listen(handle, "mousedown", event => this.#onDialMouseDown(event));
      this.listen(dial, "click", event => this.#onDialClick(event));
      this.listen(dial, "mousemove", event => this.#onDialHover(event));
      this.listen(dial, "mouseleave", () => dial.classList.remove("knob-hover"));

      requestAnimationFrame(() => this.#updateUI());
    }

    #syncRingThickness() {
      if (!this.dial) {
        return;
      }
      const size = parseFloat(window.getComputedStyle(this.dial.dial).width);
      if (!(size > 0)) {
        return;
      }
      const thickness = String((DIAL_RING_THICKNESS_PX * 100) / size);
      this.dial.ringCircle.setAttribute("stroke-width", thickness);
      this.dial.arcCircle.setAttribute("stroke-width", thickness);
    }

    #isOverKnob(event) {
      const rect = window.windowUtils.getBoundsWithoutFlushing(this.dial.dial);
      const offsetX = event.clientX - (rect.left + rect.width / 2);
      const offsetY = event.clientY - (rect.top + rect.height / 2);
      return Math.hypot(offsetX, offsetY) < rect.width * DIAL_KNOB_RATIO;
    }

    #onDialClick(event) {
      const { dial } = this.dial;
      if (performance.now() - this.#lastDragEnd < DIAL_CLICK_GUARD_MS) {
        return;
      }
      if (
        !dial.hasAttribute("disabled") &&
        this.#isOverKnob(event) &&
        this.#currentRotation !== DEFAULT_ROTATION
      ) {
        this.#setRotation(DEFAULT_ROTATION, { animate: true });
        this.#commit(true);
      }
    }

    #onDialHover(event) {
      const { dial } = this.dial;
      if (dial.hasAttribute("disabled") || this.#dragging) {
        return;
      }
      dial.classList.toggle("knob-hover", this.#isOverKnob(event));
    }

    #onDialMouseDown(event) {
      event.preventDefault();
      if (this.dial.dial.hasAttribute("disabled")) {
        return;
      }
      this.#dragging = true;
      this.mods.setInteracting("rotation", true);
      this.#dialBounds = window.windowUtils.getBoundsWithoutFlushing(this.dial.dial);
      this.dial.handleContainer.classList.add("dragging");

      const dragAbort = new AbortController();
      const signal = AbortSignal.any([this.signal, dragAbort.signal]);
      document.addEventListener("mousemove", event => this.#onDialMouseMove(event), { signal });
      document.addEventListener(
        "mouseup",
        () => {
          dragAbort.abort();
          this.#onDialMouseUp();
        },
        { signal }
      );
    }

    #onDialMouseMove(event) {
      if (!this.#dragging) {
        return;
      }
      const rect = this.#dialBounds;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const degrees = (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;
      const mouseAngle = ((Math.round(degrees) % 360) + 360) % 360;

      let rotation = mouseAngle + DEFAULT_ROTATION;
      while (rotation > 180) {
        rotation -= 360;
      }
      while (rotation <= -180) {
        rotation += 360;
      }

      this.#pendingRotation = rotation;
      if (!this.#dragRaf) {
        this.#dragRaf = requestAnimationFrame(() => {
          this.#dragRaf = 0;
          this.#flushDrag();
        });
      }
    }

    #flushDrag() {
      if (this.#dragRaf) {
        cancelAnimationFrame(this.#dragRaf);
        this.#dragRaf = 0;
      }
      const rotation = this.#pendingRotation;
      this.#pendingRotation = null;
      if (rotation === null || rotation === this.#currentRotation) {
        return;
      }
      this.#currentRotation = rotation;
      this.#updateUI();
      this.picker.updateCurrentWorkspace(true);
    }

    #onDialMouseUp() {
      if (!this.#dragging) {
        return;
      }
      this.#flushDrag();
      this.#dragging = false;
      this.#dialBounds = null;
      this.#lastDragEnd = performance.now();
      this.mods.setInteracting("rotation", false);
      this.dial.handleContainer.classList.remove("dragging");
      this.#commit(true);
    }

    #setRotation(rotation, { animate = false } = {}) {
      if (rotation === this.#currentRotation) {
        return;
      }
      if (animate) {
        this.#enableDialAnimation();
      }
      this.#currentRotation = rotation;
      this.#updateUI();
    }

    #enableDialAnimation() {
      if (!this.dial) {
        return;
      }
      this.dial.handleContainer.classList.add("zen-programmatic-change");
      this.mods.scheduler.schedule(
        "rotation-programmatic",
        () => this.dial?.handleContainer.classList.remove("zen-programmatic-change"),
        DIAL_ANIMATION_MS,
        { debounce: true }
      );
    }

    #commit(save) {
      this.picker.updateCurrentWorkspace(!save);
    }

    #restoreRotation(workspace = this.mods.getWorkspace()) {
      if (this.#dragging || !workspace) {
        return;
      }
      this.#setRotation(this.mods.rotationStore.get(workspace) ?? DEFAULT_ROTATION, { animate: true });
    }

    #updateUI() {
      if (!this.dial) {
        return;
      }
      const { dial, arcCircle, dialArc, label, labelText, handleContainer } = this.dial;
      const isDisabled = (this.picker.dots?.length ?? 0) <= 1;
      const angle = isDisabled ? 0 : this.displayAngle;

      dial.toggleAttribute("disabled", isDisabled);

      if (this.#lastDisabled !== null && this.#lastDisabled !== isDisabled && !this.#dragging) {
        this.#enableDialAnimation();
      }
      this.#lastDisabled = isDisabled;

      const key = `${isDisabled ? 1 : 0}:${angle}`;
      if (key === this.#lastUIKey) {
        return;
      }
      this.#lastUIKey = key;

      label.style.opacity = isDisabled ? "0" : "1";
      handleContainer.style.transform = `rotate(${angle}deg)`;

      dialArc.style.opacity = isDisabled ? "0" : "";
      if (!isDisabled) {
        labelText.textContent = `${angle}°`;
      }
      arcCircle.style.transition = handleContainer.classList.contains("zen-programmatic-change")
        ? "stroke-dasharray 0.4s cubic-bezier(0.4, 0, 0.2, 1)"
        : "";
      arcCircle.setAttribute(
        "stroke-dasharray",
        `${(angle / 360) * DIAL_CIRCUMFERENCE} ${DIAL_CIRCUMFERENCE}`
      );
    }

    #rotateGradient(ctx) {
      const picker = ctx.self;
      const [colors, forToolbar = false] = ctx.args;
      const themedColors = picker.themedColors(colors);
      if (themedColors.length <= 1) {
        return;
      }

      const rotation = this.mods.renderingRotation ?? this.#currentRotation;
      const delta = toDisplayAngle(rotation);
      const context = this.#createColorContext(picker);
      const css = themedColors.map(color => this.#resolveColor(picker, color, forToolbar, context));

      if (themedColors.some(color => color.isCustom)) {
        const stops = css
          .map((color, i) => `${color} ${(i / (css.length - 1)) * 100}%`)
          .join(", ");
        ctx.result = `linear-gradient(${DEFAULT_ROTATION + delta}deg, ${stops})`;
        return;
      }

      ctx.result = this.#buildGradient(css, delta, forToolbar);
    }

    #createColorContext(picker) {
      return {
        opacity: Number.isFinite(picker.currentOpacity) ? picker.currentOpacity : 0.5,
        canBeTransparent: picker.canBeTransparent,
        isLegacyDark: picker.isLegacyVersion && picker.isDarkMode,
        allowSidebar: lazy.gAcrylicElements,
        base: null,
      };
    }

    #resolveColor(picker, color, forToolbar, context) {
      if (color.isCustom) {
        return color.c;
      }
      let rgb = color.c;
      let opacity = context.opacity;

      if ((forToolbar && !context.allowSidebar) || (!forToolbar && !context.canBeTransparent)) {
        context.base ??= picker.getToolbarModifiedBaseRaw().slice(0, 3);
        rgb = picker.blendColors(rgb, context.base, context.canBeTransparent ? 90 : opacity * 100);
        opacity = 1; 
      }
      if (context.isLegacyDark) {
        rgb = picker.blendColors(rgb, [0, 0, 0], 30);
      }
      return picker.blendWithWhiteOverlay(rgb, opacity);
    }

    #buildGradient(colors, delta, forToolbar) {
      return buildRotatedGradient(colors, delta, forToolbar);
    }
  }

  // Manages custom palettes (vibrant, dark, B&W) and random generation
  class nsZenPickerPalette extends nsZenPickerFeature {
    #selectedMode = null; 
    #internalUpdate = false;
    #restoring = false; 
    #sliderRaf = 0;
    #pendingLightness = null;
    #animationRaf = 0;
    #isAnimating = false;
    #lastWorkspaceId = null;
    #lastSyncedLightness = 50;
    #lastVisualValue = null;

    init(picker) {
      super.init(picker);
      this.#lastWorkspaceId = this.mods.getWorkspace()?.uuid ?? null;
      this.#buildButtons();
      this.#buildSlider();
      this.#installHooks();

      this.listen(this.mods.events, "palette-restore", event => {
        const { phase, paletteType, lightness } = event.detail;
        if (phase === "end") {
          this.#internalUpdate = false;
          this.#restoring = false;
          this.#updateUI(false, { skipSlider: true });
          return;
        }
        this.#internalUpdate = true;
        this.#restoring = true;
        this.#selectedMode =
          PALETTE_MODES.find(
            mode =>
              mode.type === paletteType &&
              (mode.lightness === undefined || Math.abs(mode.lightness - lightness) < 5)
          ) ?? null;
        this.#forceNativeLightness(lightness);

        const isExplicit = paletteType === "explicit-lightness";
        if (this.slider) {
          this.slider.disabled = !isExplicit;
          this.sliderWrapper?.setAttribute("disabled", !isExplicit);
        }
        this.#moveSliderTo(isExplicit ? lightness : paletteType === "explicit-black-white" ? 0 : 50);
      });

      this.listen(this.mods.events, "set-lightness", event => {
        const { lightness, project, native } = event.detail;
        if (this.slider && !this.mods.isInteracting("lightness") && this.mods.isPickerSurfaceReady()) {
          this.#animateSliderValue(lightness);
        } else {
          if (this.slider) {
            this.slider.value = lightness;
          }
          this.#updateLightnessVisuals(lightness);
        }
        if (project) {
          this.#projectLightness(lightness, { native });
        }
      });

      this.listen(
        document.getElementById("PanelUI-zen-gradient-generator-color-pages"),
        "click",
        event => {
          if (event.target.classList.contains("zen-theme-picker-box")) {
            this.#selectedMode = null;
            this.#updateUI();
          }
        },
        { capture: true }
      );
    }

    uninit() {
      cancelAnimationFrame(this.#sliderRaf);
      cancelAnimationFrame(this.#animationRaf);
      super.uninit();
    }

    #buildButtons() {
      const actions = document.getElementById("PanelUI-zen-gradient-generator-color-actions");
      const gradientPanel = this.mods.gradientElement;
      if (!actions || !gradientPanel) {
        return;
      }

      const cycleButton = document.createElement("button");
      cycleButton.id = "zen-picker-palette-cycle";
      cycleButton.className = "subviewbutton zen-picker-action";
      this.#swallowEvents(cycleButton, () => {
        if (!cycleButton.disabled) {
          this.#cyclePalette();
        }
      });
      const heart = document.getElementById("zen-picker-favorite-save");
      if (heart) {
        heart.before(cycleButton);
      } else {
        actions.append(cycleButton);
      }

      const randomButton = document.createElement("button");
      randomButton.id = "zen-picker-randomize";
      randomButton.className = "subviewbutton zen-picker-action";
      randomButton.setAttribute("tooltiptext", "Randomize gradient");
      this.#swallowEvents(randomButton, () => this.#randomizeGradient());
      gradientPanel.append(randomButton);

      this.#updateUI();
    }

    #swallowEvents(button, onActivate) {
      for (const type of ["mousedown", "click", "mouseup", "command"]) {
        this.listen(
          button,
          type,
          event => {
            event.stopPropagation();
            if (type === "click" || type === "command") {
              event.preventDefault();
              onActivate();
            }
          },
          { capture: true }
        );
      }
    }

    #installHooks() {
      const { hooks } = this.mods;
      const priority = HOOK_PRIORITY.PALETTE;
      const picker = this.picker;

      hooks.add(picker, "updateCurrentWorkspace", "before", ctx => this.#beforeUpdate(ctx), priority);
      hooks.add(picker, "updateCurrentWorkspace", "after", ctx => this.#afterUpdate(ctx), priority);

      hooks.add(
        picker,
        "onWorkspaceChange",
        "before",
        ctx => {
          const incomingId = ctx.args[0]?.uuid || this.mods.getWorkspace()?.uuid;
          if (incomingId && incomingId !== this.#lastWorkspaceId && !this.#internalUpdate) {
            this.#selectedMode = null;
          }
          ctx.incomingId = incomingId;
        },
        priority
      );
      hooks.add(
        picker,
        "onWorkspaceChange",
        "after",
        ctx => {
          if (ctx.incomingId) {
            this.#lastWorkspaceId = ctx.incomingId;
          }
        },
        priority
      );

      hooks.add(
        picker,
        "getGradient",
        "before",
        ctx => {
          const { renderingWorkspaceId } = this.mods;
          const appliesHere = !renderingWorkspaceId || renderingWorkspaceId === this.mods.getWorkspace()?.uuid;
          const mode = this.#selectedMode;
          const [colors] = ctx.args;
          if (!appliesHere || mode?.type !== "explicit-lightness" || !colors.length) {
            return;
          }
          const algorithm = ctx.self.useAlgo || "";
          ctx.args[0] = colors.map(color => {
            const copy = { ...color, type: mode.type };
            if (mode.lightness !== undefined) {
              copy.lightness = mode.lightness;
            }
            if (algorithm) {
              copy.algorithm = algorithm;
            }
            return copy;
          });
        },
        priority
      );
    }

    #beforeUpdate(ctx) {
      const workspaceId = this.mods.getWorkspace()?.uuid;
      ctx.workspaceId = workspaceId;
      ctx.isWorkspaceChange = Boolean(
        workspaceId && this.#lastWorkspaceId && workspaceId !== this.#lastWorkspaceId
      );
      if (this.#internalUpdate) {
        return;
      }
      if (ctx.isWorkspaceChange || (!ctx.self.dots.length && this.#selectedMode)) {
        this.#selectedMode = null;
      }
    }

    #afterUpdate(ctx) {
      const picker = ctx.self;
      const [skipSave = true] = ctx.args;
      const lightness = picker.dots[0]?.lightness ?? 50;
      const lightnessChanged = Math.abs(this.#lastSyncedLightness - lightness) > 0.5;
      const isRotating = this.mods.isInteracting("rotation");

      if (lightnessChanged && !isRotating && !this.#internalUpdate) {
        this.#selectedMode = null;
      }
      const animate = (!skipSave && !isRotating) || ctx.isWorkspaceChange || (lightnessChanged && !isRotating);

      if (skipSave && this.mods.isInteracting()) {
        this.mods.scheduler.schedule("palette-ui", () => this.#updateUI(false), PALETTE_UI_THROTTLE_MS);
      } else {
        this.#updateUI(animate);
      }
      this.#lastWorkspaceId = ctx.workspaceId;
      this.#lastSyncedLightness = lightness;
      this.mods.emit("picker-state-changed", { source: "palette" });
    }

    #forceNativeLightness(lightness) {
      const { cx, cy, radius, dotHalfSize } = this.mods.getPickerGeometry();
      const x = cx + radius * (lightness / 100) - dotHalfSize;
      const y = cy - dotHalfSize;
      this.picker.getColorFromPosition(x, y, "force-update");
    }

    #getTheme() {
      return this.mods.getWorkspace()?.theme;
    }

    #getCurrentModeIndex() {
      if (this.#selectedMode) {
        return PALETTE_MODES.findIndex(mode => mode.id === this.#selectedMode.id);
      }
      const firstDot = this.picker.dots[0];
      const theme = this.#getTheme();
      const type = firstDot ? firstDot.type : theme?.gradientColors?.[0]?.type;
      const lightness = firstDot ? firstDot.lightness : (theme?.lightness ?? 50);

      if (type === "explicit-black-white") {
        return PALETTE_MODES.findIndex(mode => mode.id === "bw");
      }
      if (type === "explicit-lightness") {
        if (lightness >= 80) {
          return PALETTE_MODES.findIndex(mode => mode.id === "pastel");
        }
        if (lightness <= 20) {
          return PALETTE_MODES.findIndex(mode => mode.id === "deep-dark");
        }
        if (lightness <= 45) {
          return PALETTE_MODES.findIndex(mode => mode.id === "dark");
        }
        return PALETTE_MODES.findIndex(mode => mode.id === "vibrant");
      }
      return 0;
    }

    #cyclePalette() {
      const next = PALETTE_MODES[(this.#getCurrentModeIndex() + 1) % PALETTE_MODES.length];
      this.#applyMode(next);
      this.mods.showToast(`Switched to ${next.toastLabel} palette`, "zen-palette-switched-toast");
    }

    #applyMode(mode) {
      this.#selectedMode = mode;
      if (this.picker.dots.length) {
        this.#commitDots(() => {
          for (const dot of this.picker.dots) {
            if (mode.lightness !== undefined) {
              dot.lightness = mode.lightness;
            }
            dot.type = mode.type;
          }
          if (mode.lightness !== undefined) {
            this.#forceNativeLightness(mode.lightness);
          }
        }, mode.type);
      }
      this.#updateUI(true);
    }

    #commitDots(mutate, typeOverride) {
      this.#internalUpdate = true;
      try {
        mutate();
        const positions = this.picker.dots.map(dot => ({
          ID: dot.ID,
          position: dot.position,
          type: typeOverride === undefined ? dot.type : typeOverride,
        }));
        this.picker.handleColorPositions(positions, true);
        this.picker.updateCurrentWorkspace(false);
      } finally {
        this.#internalUpdate = false;
      }
    }

    // Picks random dots, harmony, and properties to create a quick custom theme
    #randomizeGradient() {
      const picker = this.picker;
      const radius = this.mods.getGradientSize().width / 2;
      const center = radius;

      const dotCount = randomInt(2, MAX_DOTS);
      const mode = pickRandom(PALETTE_MODES.filter(candidate => candidate.id !== "bw"));
      const harmony = pickRandom(RANDOM_HARMONIES_BY_COUNT[dotCount]);

      const angle = Math.random() * Math.PI * 2;
      const distance = radius * (0.4 + Math.random() * 0.5);
      const primary = { x: center + Math.cos(angle) * distance, y: center + Math.sin(angle) * distance };

      const seedDots = Array.from({ length: dotCount }, (_, ID) => ({
        ID,
        position: { ...primary },
        type: mode.type,
      }));
      picker.useAlgo = harmony;
      const dots = picker.calculateCompliments(seedDots, "update", harmony) || seedDots;

      this.mods.emit("apply-gradient-state", {
        algo: harmony,
        lightness: mode.lightness ?? Math.round((distance / radius) * 100),
        numDots: dotCount,
        paletteType: mode.type,
        opacity: Math.round((RANDOM_OPACITY_MIN + Math.random() * (1 - RANDOM_OPACITY_MIN)) * 100) / 100,
        texture: randomInt(0, RANDOM_TEXTURE_MAX_STEP) / RANDOM_TEXTURE_STEPS,
        rotation: randomInt(-179, 180),
        dots: dots.slice(0, dotCount).map((dot, id) => {
          const position = clampToCircle(dot.position, center, radius * 0.96);
          return { id, x: position.x, y: position.y };
        }),
      });
    }

    #updateUI(animate = false, { skipSlider = false } = {}) {
      const button = document.getElementById("zen-picker-palette-cycle");
      if (!button) {
        return;
      }
      const dotCount = this.picker.dots?.length || 0;
      button.disabled = dotCount === 0;
      const mode = PALETTE_MODES[this.#getCurrentModeIndex()];
      button.setAttribute("tooltiptext", `Palette: ${mode.label}${this.#selectedMode ? " (Forced)" : ""}`);

      const slider = this.slider;
      if (!slider) {
        return;
      }
      const wrapper = this.sliderWrapper;
      const isExplicit = mode.type === "explicit-lightness";
      const isDisabled = dotCount === 0 || !isExplicit;
      slider.disabled = isDisabled;
      wrapper?.setAttribute("disabled", isDisabled);

      if (skipSlider || this.#restoring) {
        return;
      }

      const target = isExplicit
        ? (this.#selectedMode?.lightness ?? this.#getTheme()?.lightness ?? this.picker.dots[0]?.lightness ?? 50)
        : mode.type === "explicit-black-white"
          ? 0
          : 50;

      if (animate && !this.#isAnimating) {
        wrapper?.classList.add("zen-programmatic-change");
        this.#animateSliderValue(target);
        this.mods.scheduler.schedule(
          "palette-programmatic",
          () => wrapper?.classList.remove("zen-programmatic-change"),
          SLIDER_ANIMATION_MS + 100,
          { debounce: true }
        );
      } else if (!this.#isAnimating) {
        if (isExplicit) {
          slider.value = target;
        }
        slider.setAttribute("tooltiptext", `Lightness: ${Math.round(target)}%`);
        this.#updateLightnessVisuals(target);
      }
    }

    #moveSliderTo(target) {
      const slider = this.slider;
      target = Number(target);
      if (!slider || !Number.isFinite(target)) {
        return;
      }
      if (this.mods.isPickerSurfaceReady() && !this.mods.isInteracting("lightness")) {
        this.#animateSliderValue(target);
        return;
      }
      cancelAnimationFrame(this.#animationRaf);
      this.#isAnimating = false;
      slider.value = target;
      this.#updateLightnessVisuals(target);
    }

    #constrainLightness(value) {
      if (lazy.gLightnessInversion) {
        const isDark = this.picker.isDarkMode;
        if (isDark && value > 50) {
          return 50;
        }
        if (!isDark && value < 50) {
          return 50;
        }
      }
      return value;
    }

    #buildSlider() {
      const row = this.mods.getSecondaryRow();
      if (!row || document.getElementById("zen-picker-lightness-wrapper")) {
        return;
      }

      const stopColor = "light-dark(rgb(90, 90, 90), rgb(161, 161, 161))";
      const trackColor = "var(--zen-picker-track-color)";
      const stop = (id, offset, color) =>
        createSVGElement("stop", { id, offset, "stop-color": color });

      const path = createSVGElement("path", {
        id: "zen-picker-lightness-path",
        d: WAVE_LINE_PATH,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      });

      const svg = createSVGElement(
        "svg",
        { viewBox: "0 -7.605 455 70", preserveAspectRatio: "none" },
        createSVGElement(
          "defs",
          {},
          createSVGElement(
            "linearGradient",
            { id: LIGHTNESS_GRADIENT_ID, x1: "0%", y1: "0%", x2: "100%", y2: "0%" },
            stop("zen-picker-lightness-stop-1", "0%", stopColor),
            stop("zen-picker-lightness-stop-2", "0%", stopColor),
            stop("zen-picker-lightness-stop-3", "100%", trackColor)
          )
        ),
        path
      );

      const waveBox = document.createXULElement("hbox");
      waveBox.id = "zen-picker-lightness-wave";
      waveBox.setAttribute("flex", "1");
      waveBox.append(svg);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.id = "zen-picker-lightness-slider";
      slider.min = "5";
      slider.max = "95";
      slider.step = "any"; 
      slider.value = "50";
      slider.setAttribute("flex", "1");

      const wrapper = document.createXULElement("vbox");
      wrapper.id = "zen-picker-lightness-wrapper";
      wrapper.setAttribute("flex", "1");
      wrapper.setAttribute("align", "stretch");
      wrapper.append(waveBox, slider);
      row.prepend(wrapper);

      this.slider = slider;
      this.sliderWrapper = wrapper;
      this.#updateLightnessVisuals(50);

      this.listen(slider, "mousedown", () => {
        this.mods.setInteracting("lightness", true);
        window.addEventListener("mouseup", () => this.mods.setInteracting("lightness", false), {
          capture: true,
          once: true,
          signal: this.signal,
        });
      });
      this.listen(slider, "input", event => this.#onSliderInput(event));
      this.listen(slider, "change", event => this.#onSliderChange(event));
    }

    #onSliderInput(event) {
      const raw = parseFloat(event.target.value);
      const value = this.#constrainLightness(raw);
      if (value !== raw) {
        event.target.value = value;
      }
      event.target.setAttribute("tooltiptext", `Lightness: ${Math.round(value)}%`);
      this.#updateLightnessVisuals(value);

      let baseMode = PALETTE_MODES[this.#getCurrentModeIndex()];
      if (baseMode?.type !== "explicit-lightness" && baseMode?.type !== "explicit-black-white") {
        baseMode = PALETTE_MODES.find(mode => mode.id === "vibrant");
      }
      this.#selectedMode = { ...baseMode, lightness: value };

      this.#pendingLightness = value;
      if (!this.#sliderRaf) {
        this.#sliderRaf = requestAnimationFrame(() => {
          this.#sliderRaf = 0;
          this.#flushLightness();
        });
      }
    }

    #onSliderChange(event) {
      cancelAnimationFrame(this.#sliderRaf);
      this.#sliderRaf = 0;
      this.#pendingLightness = null;
      this.mods.setInteracting("lightness", false);
      this.mods.scheduler.cancel("accent");

      const raw = parseFloat(event.target.value);
      const value = this.#constrainLightness(raw);
      if (value !== raw) {
        event.target.value = value;
      }
      this.#commitDots(() => this.#forceNativeLightness(value));
      this.#updateUI(false);
    }

    #flushLightness() {
      cancelAnimationFrame(this.#sliderRaf);
      this.#sliderRaf = 0;
      const value = this.#pendingLightness;
      this.#pendingLightness = null;
      if (value === null || !this.picker.dots.length) {
        return;
      }
      this.#internalUpdate = true;
      try {
        this.#projectLightness(value, { light: true });
      } finally {
        this.#internalUpdate = false;
      }
      this.mods.emit("picker-state-changed", { source: "palette" });
    }

    #animateSliderValue(target) {
      const slider = this.slider;
      cancelAnimationFrame(this.#animationRaf);
      this.#isAnimating = false;
      target = Number(target);
      if (!Number.isFinite(target)) {
        return;
      }

      const start = this.#lastVisualValue ?? parseFloat(slider.value);
      if (Math.abs(start - target) < 0.5) {
        slider.value = target;
        slider.setAttribute("tooltiptext", `Lightness: ${Math.round(target)}%`);
        this.#updateLightnessVisuals(target);
        return;
      }

      this.#isAnimating = true;
      let startTime = null;
      const step = timestamp => {
        startTime ??= timestamp;
        const progress = Math.min((timestamp - startTime) / SLIDER_ANIMATION_MS, 1);
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = progress < 1 ? start + (target - start) * eased : target;
        slider.classList.add("zen-programmatic-change");
        slider.value = current;
        this.#updateLightnessVisuals(current);
        if (progress < 1) {
          this.#animationRaf = requestAnimationFrame(step);
          return;
        }
        this.#isAnimating = false;
        slider.classList.remove("zen-programmatic-change");
        slider.setAttribute("tooltiptext", `Lightness: ${Math.round(target)}%`);
      };
      this.#animationRaf = requestAnimationFrame(step);
    }

    #updateLightnessVisuals(value) {
      const slider = this.slider;
      value = Number(value);
      if (!Number.isFinite(value) || this.#lastVisualValue === value || !slider) {
        return;
      }
      this.#lastVisualValue = value;

      const progress = (value - 5) / 90;
      const thumbProgress = Math.max(0, Math.min(1, progress));
      const path = document.getElementById("zen-picker-lightness-path");
      if (path) {
        path.setAttribute("d", getWavePath(progress));
        const stop2 = document.getElementById("zen-picker-lightness-stop-2");
        const stop3 = document.getElementById("zen-picker-lightness-stop-3");
        const offset = `${Math.max(0, Math.min(100, progress * 100))}%`;
        stop2?.setAttribute("offset", offset);
        stop3?.setAttribute("offset", offset);
        path.style.stroke =
          progress <= 0.01
            ? stop3?.getAttribute("stop-color")
            : `url(#${LIGHTNESS_GRADIENT_ID})`;
      }
      slider.style.setProperty("--zen-thumb-height", `${40 + thumbProgress * 15}px`);
      slider.style.setProperty("--zen-thumb-width", `${10 + thumbProgress * 15}px`);
    }

    #projectLightness(lightness, { light = false, native = !light } = {}) {
      const picker = this.picker;
      const geometry = this.mods.getPickerGeometry();
      const algorithm = picker.useAlgo || this.#getTheme()?.gradientColors?.[0]?.algorithm || "";
      if (native) {
        this.#forceNativeLightness(lightness);
      }

      const colors = picker.dots.map(dot => {
        const { rgb, lightness: dotLightness } = computeDotColor(picker, dot, geometry, lightness);
        dot.lightness = dotLightness;
        if (algorithm) {
          dot.algorithm = algorithm;
        }
        dot.c = rgb;
        dot.element?.style.setProperty("--zen-theme-picker-dot-color", `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`);
        return { ...dot, type: dot.type, lightness: dotLightness, algorithm, isPrimary: dot.ID === 0 };
      });

      this.mods.applyColorsToUI(colors, { light });
      const theme = this.#getTheme();
      if (theme) {
        theme.lightness = lightness;
      }
      this.mods.emit("colors-applied", { colors, light });
    }
  }

  // Adjusts the UI contrast and scheme to keep gradients visible and readable
  class nsZenPickerDynamicTheme extends nsZenPickerFeature {
    #lastIsDark = null;
    #isInverting = false;
    #lastClosedInversionAt = 0;
    #skipNextCheck = false;

    init(picker) {
      super.init(picker);
      const { hooks, events } = this.mods;
      const priority = HOOK_PRIORITY.DYNAMIC_THEME;

      for (const name of OBSERVED_PREFS) {
        Services.prefs.addObserver(name, this);
      }
      const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
      this.listen(colorScheme, "change", () => this.#onSystemSchemeChange());

      hooks.add(
        picker,
        "shouldBeDarkMode",
        "before",
        ctx => {
          if (lazy.gTextLock) {
            ctx.result = ctx.self.isDarkMode;
            ctx.skip = true;
          }
        },
        priority
      );
      hooks.add(picker, "updateCurrentWorkspace", "before", ctx => this.#beforeUpdate(ctx), priority);
      hooks.add(
        picker,
        "updateCurrentWorkspace",
        "after",
        ctx => {
          if (ctx.skipFollowUp) {
            return;
          }
          this.mods.scheduler.schedule(
            "dyn-update",
            () => {
              if (this.mods.isPickerSurfaceReady()) {
                this.#checkFromPickerState();
              }
            },
            DYNAMIC_THEME_DELAY_MS
          );
        },
        priority
      );
      hooks.add(
        picker,
        "onWorkspaceChange",
        "after",
        () => {
          this.mods.scheduler.schedule(
            "dyn-workspace",
            () => {
              if (this.#isDotDragInProgress()) {
                return;
              }
              if (lazy.gLightnessInversion && !this.#isInverting) {
                this.#applyInversion();
              }
              if (this.mods.isPickerSurfaceReady()) {
                this.#checkFromPickerState();
              }
            },
            DYNAMIC_THEME_DELAY_MS
          );
        },
        priority
      );

      this.listen(events, "colors-applied", event =>
        this.mods.scheduler.schedule(
          "dyn-theme",
          () => this.#applyTheme(event.detail.colors),
          THEME_SWITCH_THROTTLE_MS
        )
      );
      this.#installPresetPreview();
    }

    uninit() {
      for (const name of OBSERVED_PREFS) {
        Services.prefs.removeObserver(name, this);
      }
      super.uninit();
    }

    observe(subject, topic) {
      if (topic === "nsPref:changed") {
        this.picker.updateCurrentWorkspace();
      }
    }

    #isDotDragInProgress() {
      const { picker } = this;
      return Boolean(picker.dragging || picker.draggedDot || picker.recentlyDragged);
    }

    #beforeUpdate(ctx) {
      if (!lazy.gLightnessInversion || this.#isInverting) {
        return;
      }
      if (this.#isDotDragInProgress()) {
        ctx.skipFollowUp = true;
        this.mods.scheduler.schedule(
          "dyn-post-drag",
          () => {
            if (!this.#isDotDragInProgress() && lazy.gLightnessInversion && !this.#isInverting) {
              this.#applyInversion();
            }
          },
          POST_DRAG_INVERSION_DELAY_MS,
          { debounce: true }
        );
        return;
      }
      const firstDot = ctx.self.dots?.[0];
      if (!firstDot || firstDot.type === "explicit-lightness") {
        this.#applyInversion();
      }
    }

    #onSystemSchemeChange() {
      if (!lazy.gLightnessInversion) {
        if (lazy.gTextLock) {
          this.picker.updateCurrentWorkspace();
        }
        return;
      }
      const { scheduler } = this.mods;
      scheduler.schedule("dyn-scheme-invert", () => this.#applyInversion({ forceHardRefresh: true }), SCHEME_INVERT_DELAY_MS);
      scheduler.schedule(
        "dyn-scheme-refresh",
        () => {
          if (performance.now() - this.#lastClosedInversionAt < RECENT_INVERSION_WINDOW_MS) {
            return;
          }
          this.picker.updateCurrentWorkspace(!this.mods.isPickerSurfaceReady());
        },
        SCHEME_REFRESH_DELAY_MS
      );
    }

    #installPresetPreview() {
      const pages = document.getElementById("PanelUI-zen-gradient-generator-color-pages");
      this.listen(
        pages,
        "click",
        event => {
          const box = event.target?.closest?.("box[data-position]");
          if (!box || box.classList.contains("zen-picker-favorite-box")) {
            return;
          }
          const previousType = box.getAttribute("data-type");
          const previousLightness = box.getAttribute("data-lightness");
          if (this.#normalizePresetBox(box)) {
            this.mods.showToast("Gradient inverted successfully!", "zen-gradient-inverted-toast");
          }
          this.mods.scheduler.schedule(
            "dyn-preset-restore",
            () => {
              restoreAttribute(box, "data-type", previousType);
              restoreAttribute(box, "data-lightness", previousLightness);
              if (lazy.gLightnessInversion && !this.#isInverting && this.picker.dots?.length && !this.#isDotDragInProgress()) {
                this.#applyInversion();
              }
            },
            0
          );
        },
        { capture: true }
      );
    }

    #normalizePresetBox(box) {
      if (!box.hasAttribute("data-bzgp-base-type")) {
        box.setAttribute("data-bzgp-base-type", box.getAttribute("data-type") || "explicit-lightness");
      }
      if (box.hasAttribute("data-lightness") && !box.hasAttribute("data-bzgp-base-lightness")) {
        box.setAttribute("data-bzgp-base-lightness", box.getAttribute("data-lightness"));
      }
      const baseType = box.getAttribute("data-bzgp-base-type");
      const baseLightness = Number(box.getAttribute("data-bzgp-base-lightness"));
      const isScalar = baseType === "explicit-lightness" || baseType === "explicit-black-white";
      const isDark = this.picker.isDarkMode;

      const shouldInvert =
        lazy.gLightnessInversion &&
        isScalar &&
        Number.isFinite(baseLightness) &&
        ((isDark && baseLightness > 50) || (!isDark && baseLightness < 50));

      if (isScalar) {
        box.setAttribute("data-type", baseType);
      }
      if (Number.isFinite(baseLightness)) {
        box.setAttribute("data-lightness", String(Math.round(shouldInvert ? 100 - baseLightness : baseLightness)));
      }
      return shouldInvert;
    }

    #checkFromPickerState() {
      const { picker } = this;
      if (!picker.dots?.length || !this.mods.gradientElement) {
        return;
      }
      const geometry = this.mods.getPickerGeometry();
      const colors = picker.dots.map(dot => {
        if (Array.isArray(dot.c) && dot.c.length === 3) {
          return dot;
        }
        const { rgb } = computeDotColor(picker, dot, geometry, dot.lightness ?? picker.dots[0]?.lightness ?? 50);
        return { ...dot, c: rgb, isPrimary: dot.ID === 0 };
      });
      if (lazy.gLightnessInversion && !this.#isDotDragInProgress()) {
        this.#applyInversion();
      }
      this.#applyTheme(colors);
    }

    // Follows gradient dominance to set the main OS-level dark/light preference
    #applyTheme(colors) {
      if (!lazy.gDynamicThemeSwitching) {
        return;
      }
      try {
        const dominant = this.picker.getMostDominantColor(colors);
        if (!dominant) {
          return;
        }
        const shouldBeDark = this.picker.shouldBeDarkMode(dominant);
        if (this.#lastIsDark === shouldBeDark) {
          return;
        }
        this.#lastIsDark = shouldBeDark;
        Services.prefs.setIntPref("ui.systemUsesDarkTheme", shouldBeDark ? 1 : 0);
      } catch (e) {
      }
    }

    #applyInversion({ forceHardRefresh = false } = {}) {
      const { picker } = this;
      if (!lazy.gLightnessInversion || !picker.dots?.length || this.#isInverting || this.#isDotDragInProgress()) {
        return;
      }
      const isDark = forceHardRefresh
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : picker.isDarkMode;
      const isPerDotPalette = picker.dots[0].type !== "explicit-lightness";
      const geometry = this.mods.getPickerGeometry();
      const currentLightness = this.#measureLightness(isPerDotPalette, geometry);

      const needsInversion = (isDark && currentLightness > 50) || (!isDark && currentLightness < 50);
      if (!needsInversion && !forceHardRefresh) {
        return;
      }

      this.#isInverting = true;
      try {
        const surfaceReady = this.mods.isPickerSurfaceReady();
        const finalLightness = needsInversion ? 100 - currentLightness : currentLightness;

        if (needsInversion && isPerDotPalette) {
          this.#invertPerDotPalette(geometry, surfaceReady, finalLightness);
        } else if (needsInversion) {
          for (const dot of picker.dots) {
            dot.lightness = finalLightness;
          }
          this.mods.emit("set-lightness", { lightness: finalLightness, project: true, native: surfaceReady });
        } else {
          this.mods.emit("set-lightness", { lightness: finalLightness, project: false });
        }

        this.mods.scheduler.schedule(
          "dyn-inversion-commit",
          () => {
            if (!(isPerDotPalette && !surfaceReady)) {
              picker.updateCurrentWorkspace(isPerDotPalette);
            }
          },
          INVERSION_COMMIT_DELAY_MS
        );
        if (needsInversion) {
          this.mods.showToast("Gradient inverted successfully!", "zen-gradient-inverted-toast");
        }
      } finally {
        this.mods.scheduler.schedule("dyn-inverting-reset", () => (this.#isInverting = false), INVERTING_RESET_DELAY_MS);
      }
    }

    #measureLightness(isPerDotPalette, { cx, cy, radius, dotHalfSize }) {
      const { dots } = this.picker;
      if (isPerDotPalette) {
        const meanDistance =
          dots.reduce(
            (sum, dot) => sum + Math.hypot(dot.position.x + dotHalfSize - cx, dot.position.y + dotHalfSize - cy),
            0
          ) / dots.length;
        return (meanDistance / radius) * 100;
      }
      const dotLightness = Number(dots[0].lightness);
      const spaceLightness = Number(this.mods.getWorkspace()?.theme?.lightness);
      if (Number.isFinite(dotLightness)) {
        return dotLightness;
      }
      return Number.isFinite(spaceLightness) ? spaceLightness : 50;
    }

    #invertPerDotPalette({ cx, cy, radius, dotHalfSize }, surfaceReady, finalLightness) {
      const { picker } = this;
      const positions = picker.dots.map(dot => {
        const offsetX = dot.position.x + dotHalfSize - cx;
        const offsetY = dot.position.y + dotHalfSize - cy;
        const angle = Math.atan2(offsetY, offsetX);
        const newDistance = Math.max(0, Math.min(radius, radius - Math.hypot(offsetX, offsetY)));
        delete dot.lightness;
        return {
          ID: dot.ID,
          type: dot.type,
          position: {
            x: cx + newDistance * Math.cos(angle) - dotHalfSize,
            y: cy + newDistance * Math.sin(angle) - dotHalfSize,
          },
        };
      });
      this.mods.emit("set-lightness", { lightness: finalLightness, project: false });

      if (surfaceReady) {
        picker.handleColorPositions(positions, true);
      } else {
        for (const { ID, position } of positions) {
          const dot = picker.dots.find(candidate => candidate.ID === ID);
          if (!dot) {
            continue;
          }
          dot.position = { x: position.x, y: position.y };
          if (dot.element) {
            dot.element.style.left = `${position.x}px`;
            dot.element.style.top = `${position.y}px`;
            dot.element.setAttribute(
              "data-position",
              JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) })
            );
          }
        }
      }

      const geometry = { cx, cy, radius, dotHalfSize };
      for (const dot of picker.dots) {
        const { rgb, lightness } = computeDotColor(picker, dot, geometry);
        dot.lightness = lightness;
        dot.c = rgb;
      }
      if (!surfaceReady) {
        this.#persistWhileClosed(finalLightness);
      }
    }

    #persistWhileClosed(lightness) {
      const { picker } = this;
      const workspace = this.mods.getWorkspace();
      const algorithm = picker.useAlgo || workspace?.theme?.gradientColors?.[0]?.algorithm || "";
      const colors = picker.dots.map(dot => ({
        ...dot,
        type: dot.type,
        algorithm,
        isPrimary: dot.ID === 0,
      }));
      this.mods.applyColorsToUI(colors);
      this.#lastClosedInversionAt = performance.now();

      if (!workspace?.theme) {
        return;
      }
      workspace.theme.type = "gradient";
      workspace.theme.lightness = lightness;
      workspace.theme.gradientColors = picker.dots.map(dot => ({
        c: Array.isArray(dot.c) ? [dot.c[0], dot.c[1], dot.c[2]] : [0, 0, 0],
        isCustom: Boolean(dot.isCustom),
        isPrimary: Boolean(dot.isPrimary) || dot.ID === 0,
        algorithm,
        lightness: Number.isFinite(Number(dot.lightness)) ? Number(dot.lightness) : lightness,
        position: { x: Number(dot.position?.x ?? 0), y: Number(dot.position?.y ?? 0) },
        type: dot.type,
      }));
      try {
        window.gZenWorkspaces.saveWorkspace(workspace);
      } catch (e) {
      }
    }
  }

  // Quick reset for grain texture
  class nsZenPickerGrainReset extends nsZenPickerFeature {
    #pointerDown = null;

    init(picker) {
      super.init(picker);
      const wrapper = document.getElementById("PanelUI-zen-gradient-generator-texture-wrapper");
      if (!wrapper) {
        return;
      }

      const labelText = document.createElement("span");
      labelText.textContent = "Reset";
      const label = document.createElement("div");
      label.id = "zen-grain-reset-label";
      label.append(labelText);
      wrapper.append(label);

      const isOverKnob = event => {
        const rect = window.windowUtils.getBoundsWithoutFlushing(wrapper);
        const offsetX = event.clientX - (rect.left + rect.width / 2);
        const offsetY = event.clientY - (rect.top + rect.height / 2);
        return Math.hypot(offsetX, offsetY) < rect.width * DIAL_KNOB_RATIO;
      };

      this.listen(wrapper, "mousedown", event => {
        this.#pointerDown = { x: event.clientX, y: event.clientY };
      });
      this.listen(wrapper, "mousemove", event => wrapper.classList.toggle("knob-hover", isOverKnob(event)));
      this.listen(wrapper, "mouseleave", () => wrapper.classList.remove("knob-hover"));
      this.listen(wrapper, "click", event => {
        const down = this.#pointerDown;
        const wasDrag = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > CLICK_DRAG_TOLERANCE_PX;
        if (wasDrag || !isOverKnob(event)) {
          return;
        }
        this.mods.animateGradientValues(picker.currentOpacity, 0);
      });
    }
  }

  // Manages the favorites state, UI, and reordering logic
  class nsZenPickerFavorites extends nsZenPickerFeature {
    #dragFromIndex = null;
    #suppressClickUntil = 0;
    #pageHover = null;
    #updatePagination = null;
    #applyToken = 0;
    #justAddedId = null;
    #activeId = null;
    #activeLiveFingerprint = null;
    #heartState = null; 
    #heartAnimations = [];
    #restoringToken = null;
    #restoringNumDots = null;
    #applying = false;

    init(picker) {
      super.init(picker);
      const { hooks, events } = this.mods;

      this.pagesWrapper = document.getElementById("PanelUI-zen-gradient-generator-color-pages");
      this.leftButton = document.getElementById("PanelUI-zen-gradient-generator-color-page-left");
      this.rightButton = document.getElementById("PanelUI-zen-gradient-generator-color-page-right");

      this.#buildHeartButton();

      hooks.add(picker, "handleColorPositions", "after", () => this.#scheduleButtonUpdate(), HOOK_PRIORITY.FAVORITES);
      this.listen(events, "picker-state-changed", () => this.#scheduleButtonUpdate());
      this.listen(events, "apply-gradient-state", event => this.#applyState(event.detail));
      this.listen(document.getElementById("PanelUI-zen-gradient-generator-opacity"), "input", () =>
        this.#scheduleButtonUpdate()
      );
      this.listen(
        this.pagesWrapper,
        "click",
        () => this.mods.scheduler.schedule("fav-button", () => this.#updateButtonNow(), PRESET_CLICK_SETTLE_MS),
        { capture: true }
      );

      this.#setupPagination();
      this.mods.favoritesReady.then(() => {
        this.#refreshFavorites();
        this.#updateButtonNow();
      });
    }

    #buildHeartButton() {
      const actions = document.getElementById("PanelUI-zen-gradient-generator-color-actions");
      if (!actions || document.getElementById("zen-picker-favorite-save")) {
        return;
      }
      const button = document.createElement("button");
      button.id = "zen-picker-favorite-save";
      button.className = "subviewbutton zen-picker-action";
      button.setAttribute("tooltiptext", "Toggle Favorite");
      for (const type of ["mousedown", "click", "mouseup", "command"]) {
        this.listen(
          button,
          type,
          event => {
            event.stopPropagation();
            if (type === "click" || type === "command") {
              event.preventDefault();
              this.#toggleFavorite();
            }
          },
          { capture: true }
        );
      }
      button.append(
        createSVGElement(
          "svg",
          { class: "zen-heart", viewBox: "0 0 24 24" },
          createSVGElement("path", { class: "zen-heart-outline", d: HEART_PATH }),
          createSVGElement("path", { class: "zen-heart-filled", d: HEART_PATH })
        )
      );
      actions.append(button);
    }

    #playHeartAnimation(isFavorite) {
      const heart = document.querySelector("#zen-picker-favorite-save .zen-heart");
      if (!heart || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      for (const animation of this.#heartAnimations) {
        animation.cancel();
      }
      const phase = isFavorite ? HEART_LIKE : HEART_UNLIKE;
      const layers = {
        outline: heart.querySelector(".zen-heart-outline"),
        filled: heart.querySelector(".zen-heart-filled"),
      };
      const animations = phase.tracks.map(([layer, property, frames]) => playHeartTrack(layers[layer], property, frames, phase.window));
      this.#heartAnimations = animations;
      Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        if (this.#heartAnimations === animations) {
          for (const animation of animations) {
            animation.cancel();
          }
          this.#heartAnimations = [];
        }
      });
    }

    #scheduleButtonUpdate() {
      if (this.mods.isInteracting()) {
        this.#releaseRestoreHold();
        this.mods.scheduler.schedule("fav-button", () => this.#updateButtonNow(), FAVORITE_BUTTON_THROTTLE_MS);
        return;
      }
      this.#updateButtonNow();
    }

    #updateButtonNow(force = false) {
      const button = document.getElementById("zen-picker-favorite-save");
      if (!button) {
        return;
      }
      if (!force && this.#restoringToken !== null && !this.mods.isInteracting()) {
        if (this.#applying || !this.#dotCountChangedDuringRestore()) {
          return;
        }
        this.#releaseRestoreHold();
      }
      const current = this.#getCurrentState();
      if (!current) {
        button.setAttribute("disabled", "true");
        button.classList.remove("is-favorite");
        this.#heartState = null;
        return;
      }
      button.removeAttribute("disabled");
      const isFavorite = this.#findMatches(current).length > 0;
      const changed = this.#heartState !== null && this.#heartState !== isFavorite;
      this.#heartState = isFavorite;
      button.classList.toggle("is-favorite", isFavorite);
      if (changed) {
        this.#playHeartAnimation(isFavorite);
      }
      button.setAttribute("tooltiptext", isFavorite ? "Remove from Favorites" : "Save to Favorites");
    }

    #showFavoritedNow() {
      const button = document.getElementById("zen-picker-favorite-save");
      if (!button) {
        return;
      }
      button.removeAttribute("disabled");
      const changed = this.#heartState === false;
      this.#heartState = true;
      button.classList.add("is-favorite");
      if (changed) {
        this.#playHeartAnimation(true);
      }
      button.setAttribute("tooltiptext", "Remove from Favorites");
    }

    #getCurrentState() {
      const { picker } = this;
      if (!picker.dots?.length) {
        return null;
      }
      const multiDot = picker.dots.length > 1;
      return normalizeGradient({
        algo: multiDot ? picker.useAlgo || "" : "floating",
        lightness: picker.dots[0].lightness ?? 50,
        paletteType: picker.dots[0].type,
        opacity: picker.currentOpacity,
        texture: picker.currentTexture || 0,
        rotation: multiDot ? (this.mods.rotationStore.get(this.mods.getWorkspace()) ?? DEFAULT_ROTATION) : null,
        dots: picker.dots.map(dot => ({ id: dot.ID, x: dot.position.x, y: dot.position.y })),
      });
    }

    #findMatches(current) {
      const favorites = this.mods.favorites.get();
      const fingerprint = gradientFingerprint(current);
      const matches = favorites.filter(favorite => gradientFingerprint(favorite) === fingerprint);
      if (!matches.length && this.#activeId && fingerprint === this.#activeLiveFingerprint) {
        const active = favorites.find(favorite => favorite.id === this.#activeId);
        if (active) {
          return [active];
        }
      }
      return matches;
    }

    #clearActive() {
      this.#activeId = null;
      this.#activeLiveFingerprint = null;
    }

    #dotCountChangedDuringRestore() {
      if (this.#restoringNumDots === null) {
        return false;
      }
      const current = this.#getCurrentState();
      return Boolean(current) && current.numDots !== this.#restoringNumDots;
    }

    #releaseRestoreHold() {
      if (this.#restoringToken === null) {
        return;
      }
      this.#restoringToken = null;
      this.#restoringNumDots = null;
      this.#clearActive();
    }

    #settleActive(token) {
      if (token !== this.#applyToken || !this.#activeId) {
        return;
      }
      const active = this.mods.favorites.get().find(favorite => favorite.id === this.#activeId);
      const current = this.#getCurrentState();
      if (!active || !current) {
        return;
      }
      if (
        current.numDots !== active.numDots ||
        current.paletteType !== active.paletteType ||
        this.mods.isInteracting()
      ) {
        this.#clearActive();
        return;
      }
      const fingerprint = gradientFingerprint(current);
      if (
        this.#activeLiveFingerprint === null ||
        fingerprint === this.#activeLiveFingerprint ||
        fingerprint === gradientFingerprint(active)
      ) {
        this.#activeLiveFingerprint = fingerprint;
      }
    }

    #toggleFavorite() {
      const current = this.#getCurrentState();
      if (!current) {
        return;
      }
      const store = this.mods.favorites;
      const matches = this.#findMatches(current);
      let message;
      if (matches.length) {
        store.removeByIds(matches.map(match => match.id));
        if (matches.some(match => match.id === this.#activeId)) {
          this.#clearActive();
        }
        message = "Gradient removed successfully!";
      } else {
        this.#justAddedId = store.add(current).id;
        message = "Gradient saved successfully!";
      }
      if (store.readOnly) {
        message = "Favorites file could not be read safely, so this change will not be saved";
      }
      this.#updateButtonNow();
      this.#refreshFavorites();
      this.mods.showToast(message, "zen-favorite-toggle-toast");
    }

    #applyState(state) {
      this.#applying = true;
      try {
        this.#runApplyState(state);
      } finally {
        this.#applying = false;
      }
    }

    #runApplyState(state) {
      const { picker } = this;
      const { events, scheduler } = this.mods;
      const workspace = this.mods.getWorkspace();
      if (!workspace) {
        return;
      }
      const token = ++this.#applyToken;
      this.#activeId = state.id ?? null;
      this.#activeLiveFingerprint = null;
      if (state.id) {
        this.#restoringToken = token;
        this.#restoringNumDots = state.numDots;
        this.#showFavoritedNow();
      } else {
        this.#restoringToken = null;
        this.#restoringNumDots = null;
      }
      const syncHarmony = () => events.dispatchEvent(new CustomEvent("harmony-mode", { detail: { algorithm: state.algo } }));

      this.mods.emit("palette-restore", { phase: "begin", paletteType: state.paletteType, lightness: state.lightness });
      picker.panel.classList.add("zen-favorites-restoring");

      const theme = {
        type: "gradient",
        gradientColors: state.dots.map(dot => ({
          c: [0, 0, 0],
          isCustom: false,
          algorithm: state.algo,
          isPrimary: false,
          lightness: state.lightness,
          position: { x: dot.x, y: dot.y },
          type: state.paletteType,
        })),
        opacity: state.opacity,
        texture: state.texture,
        rotation: state.rotation,
        lightness: state.lightness,
      };
      workspace.theme = theme;
      picker.getGradient(theme.gradientColors);
      syncHarmony();

      this.mods.animateGradientValues(state.opacity, state.texture || 0, () => {
        if (token !== this.#applyToken) {
          return;
        }
        syncHarmony();
      });
      this.mods.emit("set-rotation", { rotation: state.rotation ?? DEFAULT_ROTATION, save: false });

      if (state.numDots < picker.dots.length) {
        for (const dot of picker.dots.slice(state.numDots)) {
          dot.element?.remove();
        }
        picker.dots = picker.dots.slice(0, state.numDots);
      }
      syncHarmony();

      picker.handleColorPositions(
        state.dots.map(dot => ({ ID: dot.id, position: { x: dot.x, y: dot.y }, type: state.paletteType })),
        true
      );
      if (state.paletteType === "explicit-lightness") {
        for (const dot of picker.dots) {
          dot.lightness = state.lightness;
        }
        this.mods.emit("set-lightness", { lightness: state.lightness, project: true });
      }
      syncHarmony();

      picker.onWorkspaceChange(workspace, true, workspace.theme);
      scheduler.schedule(
        "fav-save",
        () => {
          const target = token === this.#applyToken && this.mods.getWorkspace();
          if (target) {
            window.gZenWorkspaces.saveWorkspace(target);
          }
        },
        FAVORITE_SAVE_DELAY_MS,
        { debounce: true }
      );

      scheduler.schedule(
        "fav-button",
        () => {
          this.#settleActive(token);
          if (this.#restoringToken === null) {
            this.#updateButtonNow();
          }
        },
        FAVORITE_BUTTON_SETTLE_MS
      );
      scheduler.schedule(
        "fav-restore-end",
        () => {
          picker.panel.classList.remove("zen-favorites-restoring");
          this.mods.emit("palette-restore", { phase: "end" });
          this.#settleActive(token);
          if (this.#restoringToken === token) {
            this.#restoringToken = null;
            this.#restoringNumDots = null;
          }
          this.#updateButtonNow(true);
        },
        FAVORITE_RESTORE_MS
      );
    }

    #getPreviewColor(dot, paletteType, lightness) {
      const { rgb } = computeDotColor(this.picker, { position: { x: dot.x, y: dot.y }, type: paletteType }, PREVIEW_GEOMETRY, lightness);
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }

    #refreshFavorites() {
      const { pagesWrapper } = this;
      if (!pagesWrapper) {
        return;
      }
      pagesWrapper.removeAttribute("dragging-favorite");
      document.getElementById("zen-picker-favorite-drag-overlay")?.remove();
      this.#dragFromIndex = null;
      this.#clearPageHover();
      for (const page of pagesWrapper.querySelectorAll(".zen-picker-favorites-page")) {
        page.remove();
      }

      const favorites = this.mods.favorites.get();
      if (favorites.length) {
        const firstNativePage = pagesWrapper.querySelector("hbox:not(.zen-picker-favorites-page)");
        for (let start = 0; start < favorites.length; start += FAVORITES_PER_PAGE) {
          const page = document.createXULElement("hbox");
          page.className = "zen-picker-favorites-page";
          for (let slot = start; slot < start + FAVORITES_PER_PAGE; slot++) {
            page.append(this.#createFavoriteBox(favorites[slot] ?? null, slot));
          }
          pagesWrapper.insertBefore(page, firstNativePage);
        }
      }
      this.#updatePagination?.();
    }

    #createFavoriteBox(favorite, slotIndex) {
      const box = document.createXULElement("box");
      box.setAttribute("data-fav-index", String(slotIndex));
      if (!favorite) {
        box.className = "zen-picker-favorite-box is-ghost";
        return box;
      }

      box.className = "zen-picker-favorite-box";
      box.setAttribute("data-num-dots", favorite.numDots);
      box.setAttribute("tooltiptext", "Click to apply. Drag to reorder.");
      const colors = favorite.dots.map(dot => this.#getPreviewColor(dot, favorite.paletteType, favorite.lightness));
      colors.forEach((color, i) => box.style.setProperty(`--c${i + 1}`, color));

      if (colors.length > 1) {
        const rotation = favorite.rotation ?? DEFAULT_ROTATION;
        box.style.setProperty("--zen-picker-preview-bg", buildRotatedGradient(colors, toDisplayAngle(rotation), false));
        box.setAttribute("data-preview-bg", "true");
      }
      const grain = Math.min(1, Math.max(0, Number(favorite.texture) || 0));
      if (grain > 0) {
        box.style.setProperty("--zen-picker-preview-grain", String(grain));
        box.setAttribute("data-preview-grain", "true");
      }
      this.listen(box, "mousedown", event => this.#onBoxMouseDown(event, box, favorite, slotIndex));

      if (favorite.id === this.#justAddedId) {
        this.#justAddedId = null;
        box.animate(
          [
            { transform: "scale(0.6)", opacity: 0 },
            { transform: "scale(1)", opacity: 1 },
          ],
          { duration: 400, easing: "cubic-bezier(0.175, 0.885, 0.32, 1.275)" }
        );
      }
      return box;
    }

    #onBoxMouseDown(downEvent, box, favorite, slotIndex) {
      if (downEvent.button !== 0 || downEvent.ctrlKey || downEvent.shiftKey || downEvent.altKey) {
        return;
      }
      downEvent.preventDefault();
      downEvent.stopPropagation();

      const { pagesWrapper, leftButton, rightButton } = this;
      const start = { x: downEvent.clientX, y: downEvent.clientY };
      let isReordering = false;
      let isLanding = false;
      let overlay = null;
      let ghost = null;
      let offset = { x: 0, y: 0 };
      let current = { x: 0, y: 0 };
      let target = { x: 0, y: 0 };
      let moveRaf = 0;
      this.#dragFromIndex = slotIndex;

      const dragAbort = new AbortController();
      const signal = AbortSignal.any([this.signal, dragAbort.signal]);

      const clearPlaceholder = () => {
        box.classList.remove("zen-favorite-placeholder");
        box.removeAttribute("dragged");
      };

      const finishDrop = () => {
        cancelAnimationFrame(moveRaf);
        overlay?.remove();
        ghost?.remove();
        pagesWrapper.removeAttribute("dragging-favorite");
        this.#updatePagination?.();
        this.#clearPageHover();
        const finalIndex = this.#getSlotIndexOf(box);
        clearPlaceholder();
        this.#dragFromIndex = null;
        this.#suppressClicks(DROP_CLICK_SUPPRESSION_MS);
        if (finalIndex > -1) {
          this.#reorderFavorites(slotIndex, slotIndex < finalIndex ? finalIndex + 1 : finalIndex);
        }
      };

      const followPointer = () => {
        if (isLanding) {
          current.x += (target.x - current.x) * DRAG_LANDING_EASE;
          current.y += (target.y - current.y) * DRAG_LANDING_EASE;
        } else {
          current = { ...target };
        }
        ghost.style.left = `${current.x}px`;
        ghost.style.top = `${current.y}px`;
        if (isLanding && Math.hypot(target.x - current.x, target.y - current.y) < 0.6) {
          finishDrop();
          return;
        }
        moveRaf = requestAnimationFrame(followPointer);
      };

      const beginReorder = event => {
        isReordering = true;
        this.#suppressClicks(CLICK_SUPPRESSION_MS);
        const rect = box.getBoundingClientRect();
        offset = { x: Math.round(rect.width / 2), y: Math.round(rect.height / 2) };
        target = { x: event.clientX - offset.x, y: event.clientY - offset.y };
        current = { ...target };

        box.classList.add("zen-favorite-placeholder");
        this.#playSlotPop(box);

        overlay = document.createElement("div");
        overlay.id = "zen-picker-favorite-drag-overlay";
        document.body.append(overlay);

        ghost = box.cloneNode(true);
        ghost.classList.remove("zen-favorite-placeholder");
        ghost.setAttribute("dragged", "true");
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
        ghost.style.left = `${current.x}px`;
        ghost.style.top = `${current.y}px`;
        (document.getElementById("mainPopupSet") || document.documentElement).append(ghost);

        pagesWrapper.setAttribute("dragging-favorite", "true");
        this.#updatePagination?.();
        moveRaf = requestAnimationFrame(followPointer);
      };

      document.addEventListener(
        "mousemove",
        event => {
          if (!isReordering && Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_START_THRESHOLD_PX) {
            beginReorder(event);
          }
          if (!isReordering || isLanding) {
            return;
          }
          target = { x: event.clientX - offset.x, y: event.clientY - offset.y };
          this.#handlePageButtonHover(event.clientX, event.clientY);
          const overPageButton = [leftButton, rightButton].some(
            button => button && !button.disabled && this.#isPointInside(event.clientX, event.clientY, button)
          );
          if (!overPageButton) {
            this.#moveSlotUnderPointer(box, event.clientX, event.clientY);
          }
        },
        { signal }
      );
      document.addEventListener(
        "mouseup",
        () => {
          dragAbort.abort();
          if (isReordering) {
            this.#clearPageHover();
            const rect = box.getBoundingClientRect();
            target = { x: rect.left, y: rect.top };
            isLanding = true;
            moveRaf = requestAnimationFrame(followPointer);
          } else if (performance.now() >= this.#suppressClickUntil) {
            this.#dragFromIndex = null;
            this.#applyState(favorite);
          }
        },
        { signal }
      );
    }

    #suppressClicks(duration) {
      this.#suppressClickUntil = performance.now() + duration;
    }

    #isPointInside(clientX, clientY, element) {
      const rect = window.windowUtils.getBoundsWithoutFlushing(element);
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }

    #getSlots() {
      return Array.from(this.pagesWrapper.querySelectorAll(".zen-picker-favorite-box"));
    }

    #getSlotIndexOf(placeholder) {
      const slots = this.#getSlots();
      const index = slots.indexOf(placeholder);
      if (index < 0) {
        return -1;
      }
      return slots.slice(0, index).filter(slot => !slot.classList.contains("is-ghost")).length;
    }

    #playSlotPop(element) {
      element.animate(
        [
          { transform: "scale(0.86)", opacity: 0.25 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    }

    #swapWithNeighbor(placeholder, direction) {
      const slots = this.#getSlots();
      const neighbor = slots[slots.indexOf(placeholder) + direction];
      if (!neighbor || neighbor === placeholder) {
        return false;
      }
      const placeholderParent = placeholder.parentNode;
      if (neighbor.parentNode === placeholderParent) {
        placeholderParent.insertBefore(direction > 0 ? neighbor : placeholder, direction > 0 ? placeholder : neighbor);
        return true;
      }
      const placeholderNext = placeholder.nextSibling;
      const neighborParent = neighbor.parentNode;
      const neighborNext = neighbor.nextSibling;
      placeholderParent.insertBefore(neighbor, placeholderNext);
      neighborParent.insertBefore(placeholder, neighborNext);
      return true;
    }

    #moveSlotUnderPointer(placeholder, clientX, clientY) {
      const slots = this.#getSlots();
      let hovered = null;
      let placeBefore = true;
      for (const slot of slots) {
        if (slot === placeholder) {
          continue;
        }
        const rect = window.windowUtils.getBoundsWithoutFlushing(slot);
        if (clientX > rect.left && clientX < rect.right && clientY > rect.top && clientY < rect.bottom) {
          hovered = slot;
          placeBefore = clientX < rect.left + rect.width / 2;
          break;
        }
      }
      if (!hovered) {
        return;
      }
      const hoveredIndex = slots.indexOf(hovered);
      const currentIndex = slots.indexOf(placeholder);
      const desiredIndex = placeBefore ? hoveredIndex : hoveredIndex + 1;
      const forward = Math.max(0, desiredIndex - currentIndex - 1);
      const backward = Math.max(0, currentIndex - desiredIndex);
      if (!forward && !backward) {
        return;
      }

      const others = slots.filter(slot => slot !== placeholder);
      const firstRects = new Map(others.map(slot => [slot, window.windowUtils.getBoundsWithoutFlushing(slot)]));
      for (let i = 0; i < forward && this.#swapWithNeighbor(placeholder, 1); i++);
      for (let i = 0; i < backward && this.#swapWithNeighbor(placeholder, -1); i++);

      this.#playSlotPop(placeholder);
      for (const slot of others) {
        const first = firstRects.get(slot);
        const last = slot.getBoundingClientRect();
        const deltaX = first.left - last.left;
        const deltaY = first.top - last.top;
        if (slot.isConnected && (deltaX || deltaY)) {
          slot.animate(
            [{ transform: `translate(${deltaX}px, ${deltaY}px)` }, { transform: "none" }],
            { duration: 220, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        }
      }
    }

    #reorderFavorites(fromIndex, toIndex) {
      const favorites = [...this.mods.favorites.get()];
      if (!favorites.length || fromIndex < 0 || fromIndex >= favorites.length) {
        return;
      }
      let insertAt = Math.max(0, Math.min(toIndex, favorites.length));
      if (fromIndex === insertAt || fromIndex + 1 === insertAt) {
        return;
      }
      const [moved] = favorites.splice(fromIndex, 1);
      if (fromIndex < insertAt) {
        insertAt -= 1;
      }
      favorites.splice(insertAt, 0, moved);
      this.mods.favorites.setOrder(favorites);
      this.#refreshFavorites();
      this.#updateButtonNow();
      this.mods.showToast("Reordered saved gradient", "zen-favorite-reorder-toast", 1200);
    }

    #getPageStride() {
      const { pagesWrapper } = this;
      return Math.max(1, pagesWrapper.scrollWidth / Math.max(1, pagesWrapper.children.length));
    }

    #getPaginationModel() {
      const { pagesWrapper } = this;
      const width = this.#getPageStride();
      const allPages = Array.from(pagesWrapper.children);
      const lastIndex = Math.max(0, allPages.length - 1);
      if (pagesWrapper.getAttribute("dragging-favorite") !== "true") {
        return { width, firstIndex: 0, lastIndex };
      }
      const favoritePages = pagesWrapper.querySelectorAll(".zen-picker-favorites-page");
      if (!favoritePages.length) {
        return { width, firstIndex: 0, lastIndex };
      }
      const firstIndex = Math.max(0, allPages.indexOf(favoritePages[0]));
      return { width, firstIndex, lastIndex: firstIndex + favoritePages.length - 1 };
    }

    #setupPagination() {
      const { pagesWrapper, leftButton, rightButton } = this;
      if (!pagesWrapper || !leftButton || !rightButton) {
        return;
      }
      const updateButtons = () => {
        const model = this.#getPaginationModel();
        const page = Math.round(pagesWrapper.scrollLeft / model.width);
        leftButton.disabled = page <= model.firstIndex;
        rightButton.disabled = page >= model.lastIndex;
      };
      this.#updatePagination = updateButtons;
      this.listen(pagesWrapper, "scroll", updateButtons);

      const step = direction => event => {
        event.stopImmediatePropagation();
        const model = this.#getPaginationModel();
        const page = Math.round(pagesWrapper.scrollLeft / model.width);
        const next = Math.max(model.firstIndex, Math.min(model.lastIndex, page + direction));
        pagesWrapper.scrollLeft = next * model.width;
        updateButtons();
      };
      this.listen(leftButton, "click", step(-1), { capture: true });
      this.listen(rightButton, "click", step(1), { capture: true });
    }

    #handlePageButtonHover(clientX, clientY) {
      if (this.#dragFromIndex === null) {
        this.#clearPageHover();
        return;
      }
      for (const [button, direction] of [[this.leftButton, -1], [this.rightButton, 1]]) {
        if (button && !button.disabled && this.#isPointInside(clientX, clientY, button)) {
          this.#queuePageMove(direction);
          return;
        }
      }
      this.#clearPageHover();
    }

    #queuePageMove(direction) {
      if (this.#pageHover?.direction === direction) {
        return;
      }
      this.#clearPageHover();
      this.#pageHover = { direction };
      this.mods.scheduler.schedule(
        "fav-page-hover",
        () => {
          this.#pageHover = null;
          const { pagesWrapper } = this;
          const pages = pagesWrapper.querySelectorAll(".zen-picker-favorites-page");
          if (pages.length <= 1) {
            return;
          }
          const width = this.#getPageStride();
          const index = Math.max(0, Math.min(pages.length - 1, Math.round(pagesWrapper.scrollLeft / width)));
          const next = Math.max(0, Math.min(pages.length - 1, index + direction));
          if (next !== index) {
            pagesWrapper.scrollLeft = next * width;
          }
        },
        PAGE_HOVER_DELAY_MS
      );
    }

    #clearPageHover() {
      this.#pageHover = null;
      this.mods.scheduler.cancel("fav-page-hover");
    }
  }

  // Main controller handling lifecycle, shared state, and initializing all features
  class nsZenPickerMods {
    events = new EventTarget();
    scheduler = new nsZenPickerScheduler();
    hooks = new nsZenPickerHooks();
    favorites = nsZenPickerFavoritesStore;
    rotationStore = nsZenPickerRotationStore;

    renderingWorkspaceId = null;
    renderingRotation = null;

    #features = [];
    #picker = null;
    #lastGeometry = null;
    #interactions = new Set();
    #toastTimers = new Map();
    #valueAnimationToken = 0;
    #abort = new AbortController();
    favoritesReady = Promise.resolve();

    constructor() {
      this.#features.push(
        new nsZenPickerHarmony(this),
        new nsZenPickerRotation(this),
        new nsZenPickerOpacity(this),
        new nsZenPickerPalette(this),
        new nsZenPickerDynamicTheme(this),
        new nsZenPickerGrainReset(this),
        new nsZenPickerFavorites(this)
      );
      this.#waitForZen();
    }

    get picker() {
      return this.#picker;
    }

    async #waitForZen() {
      for (let i = 0; i < STARTUP_MAX_RETRIES; i++) {
        if (window.gZenThemePicker && window.gZenWorkspaces?.promiseInitialized) {
          await window.gZenWorkspaces.promiseInitialized;
          this.#start(window.gZenThemePicker);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, STARTUP_RETRY_MS));
      }
    }

    #start(picker) {
      this.#picker = picker;
      picker.constructor.MAX_DOTS = MAX_DOTS;
      this.#installCoreHooks(picker);
      this.favoritesReady = this.favorites.load();

      for (const feature of this.#features) {
        try {
          feature.init(picker);
        } catch (e) {
        }
      }

      this.rotationStore.migrateLegacyPrefs(window.gZenWorkspaces.getWorkspaces?.() ?? []);
      picker.panel.addEventListener("popupshown", () => requestAnimationFrame(() => this.#alignSecondaryRow()), {
        signal: this.#abort.signal,
      });
      picker.panel.addEventListener("popuphidden", () => this.favorites.flush(), { signal: this.#abort.signal });
      window.addEventListener("unload", () => this.uninit(), { once: true });
    }

    uninit() {
      this.#abort.abort();
      for (const feature of this.#features) {
        try {
          feature.uninit();
        } catch (e) {
        }
      }
      this.#valueAnimationToken++;
      this.hooks.uninstall();
      this.scheduler.cancelAll();
      this.favorites.flush();
      for (const id of this.#toastTimers.values()) {
        clearTimeout(id);
      }
      this.#toastTimers.clear();
    }

    emit(name, detail = {}) {
      this.events.dispatchEvent(new CustomEvent(name, { detail }));
    }

    get gradientElement() {
      return this.#picker?.panel?.querySelector(".zen-theme-picker-gradient") ?? null;
    }

    getPickerGeometry() {
      const el = this.gradientElement;
      const rect = el && window.windowUtils.getBoundsWithoutFlushing(el);

      if (rect && rect.width > MIN_VALID_RECT_SIZE && rect.height > MIN_VALID_RECT_SIZE) {
        const width = rect.width + PICKER_PADDING * 2;
        const height = rect.height + PICKER_PADDING * 2;
        const last = this.#lastGeometry;
        if (!last || last.width !== width || last.height !== height) {
          this.#lastGeometry = this.#geometry(width, height);
        }
        return this.#lastGeometry;
      }
      if (this.#lastGeometry) {
        return this.#lastGeometry;
      }
      const fallback = PICKER_FALLBACK_WIDTH + PICKER_PADDING * 2;
      return this.#geometry(fallback, fallback);
    }

    #geometry(width, height) {
      return {
        width,
        height,
        radius: (width - PICKER_PADDING) / 2,
        cx: width / 2,
        cy: height / 2,
        dotHalfSize: DOT_HALF_SIZE,
      };
    }

    getWorkspace() {
      const picker = this.#picker;
      return (
        picker?.workspaceBeingEdited ??
        window.gZenWorkspaces?.getActiveWorkspace?.() ??
        null
      );
    }

    isInteracting(kind) {
      if (kind) {
        return this.#interactions.has(kind);
      }
      return Boolean(this.#picker?.dragging) || this.#interactions.size > 0;
    }

    setInteracting(kind, active) {
      if (active) {
        this.#interactions.add(kind);
      } else {
        this.#interactions.delete(kind);
      }
    }

    getSecondaryRow() {
      let row = document.getElementById("zen-picker-secondary-row");
      if (row) {
        return row;
      }
      const nativeRow = document.getElementById("PanelUI-zen-gradient-colors-wrapper");
      if (!nativeRow) {
        return null;
      }
      row = document.createXULElement("hbox");
      row.id = "zen-picker-secondary-row";
      nativeRow.after(row);
      return row;
    }

    // Aligns custom mod UI rows with native elements dynamically 
    #alignSecondaryRow() {
      const bounds = element => element && window.windowUtils.getBoundsWithoutFlushing(element);
      const nativeSlider = bounds(document.getElementById("PanelUI-zen-gradient-generator-opacity"));
      const slider = bounds(document.getElementById("zen-picker-lightness-slider"));
      const wrapper = document.getElementById("zen-picker-lightness-wrapper");
      const grain = bounds(document.getElementById("PanelUI-zen-gradient-generator-texture-wrapper"));
      const dial = bounds(document.getElementById("zen-rotation-dial-wrapper"));
      const dialWrapper = document.getElementById("zen-picker-rotation-wrapper");
      const usable = rect => rect && rect.width > MIN_VALID_RECT_SIZE / 2;

      if (usable(grain) && usable(dial) && dialWrapper) {
        const shift = dial.right - grain.right;
        if (Math.abs(shift) > 0.5 && Math.abs(shift) < 60) {
          const margin = parseFloat(dialWrapper.style.marginRight) || 0;
          dialWrapper.style.marginRight = `${margin + shift}px`;
        }
      }
      if (usable(nativeSlider) && usable(slider) && wrapper) {
        const difference = nativeSlider.width - slider.width;
        if (Math.abs(difference) > 0.5 && Math.abs(difference) < 60) {
          const current = window.windowUtils.getBoundsWithoutFlushing(wrapper).width;
          wrapper.style.flex = `0 0 ${current + difference}px`;
        }
      }
    }

    applyColorsToUI(colors, { light = false } = {}) {
      const picker = this.#picker;
      this.#setBackgroundStyles(picker.getGradient(colors), picker.getGradient(colors, true));

      if (light) {
        this.scheduler.schedule("accent", () => this.applyAccent(colors), ACCENT_THROTTLE_MS);
        return null;
      }
      this.scheduler.cancel("accent");
      return this.applyAccent(colors);
    }

    applyAccent(colors) {
      const picker = this.#picker;
      const dominant = picker.getMostDominantColor(colors);
      if (!dominant) {
        return null;
      }
      try {
        const isDark = picker.shouldBeDarkMode(dominant);
        const root = document.documentElement;
        const [r, g, b, a] = picker.getToolbarColor(isDark, dominant);
        root.setAttribute("zen-should-be-dark-mode", isDark);
        root.style.setProperty("--zen-primary-color", picker.getAccentColorForUI(dominant, isDark));
        root.style.setProperty("--toolbox-textcolor", `rgba(${r}, ${g}, ${b}, ${a})`);
        root.style.setProperty("--toolbar-color-scheme", isDark ? "dark" : "light");
      } catch (e) {
      }
      return dominant;
    }

    #setBackgroundStyles(gradient, toolbarGradient) {
      const picker = this.#picker;
      const root = document.documentElement;
      const browserBackground = picker.browserBackgroundElement || root;
      const toolbarBackground = picker.toolbarBackgroundElement || root;

      browserBackground.style.setProperty("--zen-main-browser-background", gradient);
      toolbarBackground.style.setProperty("--zen-main-browser-background-toolbar", toolbarGradient);

      if (browserBackground !== root || toolbarBackground !== root) {
        this.scheduler.schedule(
          "root-background",
          () => {
            if (browserBackground !== root) {
              root.style.setProperty("--zen-main-browser-background", gradient);
            }
            if (toolbarBackground !== root) {
              root.style.setProperty("--zen-main-browser-background-toolbar", toolbarGradient);
            }
          },
          ROOT_BACKGROUND_DEBOUNCE_MS,
          { debounce: true }
        );
      }
    }

    isPickerSurfaceReady() {
      if (document.getElementById("PanelUI-zen-gradient-generator")?.state !== "open") {
        return false;
      }
      const element = this.gradientElement;
      const rect = element && window.windowUtils.getBoundsWithoutFlushing(element);
      return Boolean(rect) && rect.width > MIN_VALID_RECT_SIZE && rect.height > MIN_VALID_RECT_SIZE;
    }

    getGradientSize() {
      const element = this.gradientElement;
      const rect = element && window.windowUtils.getBoundsWithoutFlushing(element);
      return rect ?? { width: PICKER_FALLBACK_WIDTH, height: PICKER_FALLBACK_WIDTH };
    }

    #installCoreHooks(picker) {
      this.hooks.add(
        picker,
        "getGradientForWorkspace",
        "before",
        ctx => {
          const [workspace] = ctx.args;
          ctx.previousAlgorithm = ctx.self.useAlgo;
          this.renderingWorkspaceId = workspace?.uuid ?? null;
          this.renderingRotation = this.rotationStore.get(workspace) ?? DEFAULT_ROTATION;
        },
        HOOK_PRIORITY.CORE
      );
      this.hooks.add(
        picker,
        "getGradientForWorkspace",
        "after",
        ctx => {
          this.renderingWorkspaceId = null;
          this.renderingRotation = null;
          ctx.self.useAlgo = ctx.previousAlgorithm;
        },
        HOOK_PRIORITY.CORE
      );
    }

    animateGradientValues(toOpacity, toTexture, onDone) {
      const picker = this.#picker;
      const token = ++this.#valueAnimationToken;
      const startTime = performance.now();
      const fromOpacity = Number.isFinite(picker.currentOpacity)
        ? picker.currentOpacity
        : (parseFloat(this.opacityFeature?.slider?.value) || 0.5);
      const fromTexture = picker.currentTexture || 0;

      if (this.opacityFeature) {
        this.opacityFeature.isAnimating = true;
        this.opacityFeature.performVisualUpdate(fromOpacity);
      }

      const step = now => {
        if (token !== this.#valueAnimationToken) {
          if (this.opacityFeature) {
            this.opacityFeature.isAnimating = false;
          }
          return;
        }
        const progress = Math.min(1, (now - startTime) / VALUE_ANIMATION_MS);
        const eased = 1 - Math.pow(1 - progress, 4); 
        const currentOpacity = fromOpacity + (toOpacity - fromOpacity) * eased;
        const currentTexture = fromTexture + (toTexture - fromTexture) * eased;

        picker.currentOpacity = currentOpacity;
        picker.currentTexture = currentTexture;
        this.opacityFeature?.performVisualUpdate(currentOpacity);
        picker.updateCurrentWorkspace(true);

        if (progress < 1) {
          requestAnimationFrame(step);
        } else {
          if (this.opacityFeature) {
            this.opacityFeature.isAnimating = false;
          }
          onDone?.();
        }
      };
      requestAnimationFrame(step);
    }

    showToast(message, toastId = "zen-gradient-toast", duration = 1800) {
      const container = document.getElementById("zen-toast-container");
      if (!container) {
        return;
      }
      const motion = window.gZenUIManager?.motion;

      container.querySelector(`.zen-toast[data-zen-toast-id="${toastId}"]`)?.remove();
      clearTimeout(this.#toastTimers.get(toastId));

      const wrapper = document.createXULElement("hbox");
      wrapper.classList.add("zen-toast");
      wrapper.setAttribute("data-zen-toast-id", toastId);
      const box = document.createXULElement("vbox");
      const label = document.createXULElement("label");
      label.textContent = message;
      box.append(label);
      wrapper.append(box);

      container.removeAttribute("hidden");
      container.append(wrapper);
      this.#reflowToasts(container);

      const finish = () => {
        wrapper.remove();
        this.#reflowToasts(container);
        if (!container.querySelector(".zen-toast")) {
          container.setAttribute("hidden", true);
        }
      };

      if (motion?.animate) {
        wrapper.style.transform = "scale(0)";
        motion.animate(wrapper, { scale: 1 }, { type: "spring", bounce: 0.2, duration: 0.5 });
      }

      this.#toastTimers.set(
        toastId,
        setTimeout(() => {
          this.#toastTimers.delete(toastId);
          if (Services.prefs.getBoolPref("ui.popup.disable_autohide", false)) {
            return;
          }
          if (motion?.animate) {
            motion
              .animate(wrapper, { opacity: [1, 0], scale: [1, 0.5] }, { duration: 0.2, bounce: 0 })
              .then(finish);
          } else {
            finish();
          }
        }, duration)
      );
    }

    #reflowToasts(container) {
      let top = 0;
      for (const toast of container.querySelectorAll(".zen-toast")) {
        const height = Math.max(TOAST_MIN_HEIGHT, Math.round(toast.clientHeight));
        toast.style.top = `${top}px`;
        top += height + TOAST_SPACING;
      }
    }
  }

  window.gZenPickerMods = new nsZenPickerMods();
})();