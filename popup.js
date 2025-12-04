const DEFAULT_SETTINGS = {
  text: "WATERMARKTEST",
  enabled: true,
  contentMode: "text",
  mode: "static",
  color: "#ffffff",
  opacity: 0.6,
  imageOpacity: 0.6,
  imageData: "",
  imageScaleX: 0.2,
  imageScaleY: 0.2,
  imageMaintainRatio: true,
  fontSize: 18,
  fontFamily: "Segoe UI, Arial, sans-serif",
  staticPosition: "top-left",
  offset: { x: 8, y: 8 },
  randomIntervalMs: 1200,
  bounceSpeed: 80,
  shadow: true,
  debug: false
};

let currentSettings = { ...DEFAULT_SETTINGS };
const SYNC_IMAGE_THRESHOLD = 7000; // chars; store larger images in local to avoid sync quota

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  loadSettings().then((settings) => {
    currentSettings = settings;
    populateForm(settings);
  });
  attachEvents();
});

function cacheElements() {
  const ids = [
    "enabled",
    "mode",
    "contentMode",
    "text",
    "color",
    "opacity",
    "imageOpacity",
    "fontSize",
    "staticPosition",
    "offsetX",
    "offsetY",
    "imageScaleX",
    "imageScaleY",
    "imageMaintainRatio",
    "randomIntervalMs",
    "bounceSpeed",
    "shadow",
    "saveBtn",
    "imageFile"
  ];
  ids.forEach((id) => {
    window[id] = document.getElementById(id);
  });
}

function attachEvents() {
  const inputs = [
    enabled,
    mode,
    contentMode,
    text,
    color,
    opacity,
    imageOpacity,
    fontSize,
    staticPosition,
    offsetX,
    offsetY,
    imageScaleX,
    imageScaleY,
    imageMaintainRatio,
    randomIntervalMs,
    bounceSpeed,
    shadow
  ];
  inputs.forEach((el) => {
    if (!el) return;
    const evt = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(evt, handleChange);
  });

  saveBtn?.addEventListener("click", saveSettings);
  imageFile?.addEventListener("change", handleImageUpload);
}

function populateForm(settings) {
  enabled.checked = settings.enabled;
  mode.value = settings.mode;
  contentMode.value = settings.contentMode || "text";
  text.value = settings.text;
  color.value = settings.color;
  opacity.value = settings.opacity;
  imageOpacity.value = settings.imageOpacity;
  fontSize.value = settings.fontSize;
  staticPosition.value = settings.staticPosition;
  offsetX.value = settings.offset.x;
  offsetY.value = settings.offset.y;
  imageScaleX.value = settings.imageScaleX;
  imageScaleY.value = settings.imageScaleY;
  imageMaintainRatio.checked = settings.imageMaintainRatio;
  randomIntervalMs.value = settings.randomIntervalMs;
  bounceSpeed.value = settings.bounceSpeed;
  shadow.checked = settings.shadow;
  imageScaleY.disabled = settings.imageMaintainRatio;
}

function handleChange() {
  currentSettings = normalizeSettings({
    ...currentSettings,
    enabled: enabled.checked,
    mode: mode.value,
    contentMode: contentMode.value,
    text: text.value || DEFAULT_SETTINGS.text,
    color: color.value || DEFAULT_SETTINGS.color,
    opacity: opacity.value,
    imageOpacity: imageOpacity.value,
    fontSize: fontSize.value,
    staticPosition: staticPosition.value,
    offset: { x: offsetX.value, y: offsetY.value },
    imageScaleX: imageScaleX.value,
    imageScaleY: imageScaleY.value,
    imageMaintainRatio: imageMaintainRatio.checked,
    randomIntervalMs: randomIntervalMs.value,
    bounceSpeed: bounceSpeed.value,
    shadow: shadow.checked
  });
  imageScaleY.disabled = imageMaintainRatio.checked;
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    opacity: clamp(settings.opacity, 0, 1, DEFAULT_SETTINGS.opacity),
    imageOpacity: clamp(settings.imageOpacity, 0, 1, DEFAULT_SETTINGS.imageOpacity),
    fontSize: clamp(settings.fontSize, 8, 200, DEFAULT_SETTINGS.fontSize),
    offset: {
      x: clamp(settings.offset?.x, 0, 200, DEFAULT_SETTINGS.offset.x),
      y: clamp(settings.offset?.y, 0, 200, DEFAULT_SETTINGS.offset.y)
    },
    imageScaleX: clamp(settings.imageScaleX, 0.05, 3, DEFAULT_SETTINGS.imageScaleX),
    imageScaleY: clamp(settings.imageScaleY, 0.05, 3, DEFAULT_SETTINGS.imageScaleY),
    imageMaintainRatio: Boolean(settings.imageMaintainRatio),
    randomIntervalMs: clamp(settings.randomIntervalMs, 200, 10000, DEFAULT_SETTINGS.randomIntervalMs),
    bounceSpeed: clamp(settings.bounceSpeed, 10, 500, DEFAULT_SETTINGS.bounceSpeed)
  };
}

function saveSettings({ keepOpen = false } = {}) {
  persistSettings(currentSettings, () => {
    if (!keepOpen) {
      window.close();
    }
  });
}

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    currentSettings = normalizeSettings({
      ...currentSettings,
      imageData: reader.result,
      contentMode: currentSettings.contentMode === "text" ? "image" : currentSettings.contentMode
    });
    saveSettings({ keepOpen: true });
  };
  reader.readAsDataURL(file);
}

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (syncItems) => {
      chrome.storage.local.get(["imageData"], (localItems) => {
        resolve({
          ...DEFAULT_SETTINGS,
          ...syncItems,
          offset: { ...DEFAULT_SETTINGS.offset, ...(syncItems.offset || {}) },
          imageData: localItems.imageData || syncItems.imageData || ""
        });
      });
    });
  });
}

function persistSettings(settings, cb = () => {}) {
  const toSync = { ...settings };
  if (toSync.imageData && toSync.imageData.length > SYNC_IMAGE_THRESHOLD) {
    const { imageData, ...rest } = toSync;
    chrome.storage.local.set({ imageData }, () => {
      chrome.storage.sync.set(rest, cb);
    });
  } else {
    chrome.storage.local.remove("imageData", () => {
      chrome.storage.sync.set(toSync, cb);
    });
  }
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}
