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
    "opacitySlider",
    "imageOpacity",
    "imageOpacitySlider",
    "fontSize",
    "staticPosition",
    "offsetX",
    "offsetY",
    "offsetSliderX",
    "offsetSliderY",
    "imageScaleX",
    "imageScaleY",
    "imageMaintainRatio",
    "randomIntervalMs",
    "bounceSpeed",
    "shadow",
    "saveBtn",
    "imageFile",
    "textSection",
    "imageSection",
    "staticPlacementSection",
    "randomPlacementSection",
    "bouncePlacementSection"
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
    imageOpacitySlider,
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

  offsetSliderX?.addEventListener("input", () => {
    if (offsetX) offsetX.value = offsetSliderX.value;
    handleChange();
  });
  offsetSliderY?.addEventListener("input", () => {
    if (offsetY) offsetY.value = offsetSliderY.value;
    handleChange();
  });
  opacitySlider?.addEventListener("input", () => {
    if (opacity) opacity.value = opacitySlider.value;
    handleChange();
  });
  imageOpacitySlider?.addEventListener("input", () => {
    if (imageOpacity) imageOpacity.value = imageOpacitySlider.value;
    handleChange();
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
  if (opacitySlider) opacitySlider.value = settings.opacity;
  imageOpacity.value = settings.imageOpacity;
  if (imageOpacitySlider) imageOpacitySlider.value = settings.imageOpacity;
  fontSize.value = settings.fontSize;
  staticPosition.value = settings.staticPosition;
  imageScaleX.value = settings.imageScaleX;
  imageScaleY.value = settings.imageScaleY;
  imageMaintainRatio.checked = settings.imageMaintainRatio;
  randomIntervalMs.value = settings.randomIntervalMs;
  bounceSpeed.value = settings.bounceSpeed;
  shadow.checked = settings.shadow;
  imageScaleY.disabled = settings.imageMaintainRatio;
  syncOffsetInputs(settings.offset);
  updateContentVisibility(settings.contentMode);
  updatePlacementVisibility(settings.mode);
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
  syncOffsetInputs(currentSettings.offset);
  syncOpacityInputs(currentSettings);
  updateContentVisibility(currentSettings.contentMode);
  updatePlacementVisibility(currentSettings.mode);
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
    contentMode.value = currentSettings.contentMode;
    updateContentVisibility(currentSettings.contentMode);
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

function updateContentVisibility(modeValue = contentMode?.value) {
  const showText = modeValue === "text" || modeValue === "both";
  const showImage = modeValue === "image" || modeValue === "both";
  toggleSection(textSection, showText);
  toggleSection(imageSection, showImage);
}

function updatePlacementVisibility(modeValue = mode?.value) {
  const showStatic = modeValue === "static";
  const showRandom = modeValue === "random-pop";
  const showBounce = modeValue === "bounce";
  toggleSection(staticPlacementSection, showStatic);
  toggleSection(randomPlacementSection, showRandom);
  toggleSection(bouncePlacementSection, showBounce);
}

function toggleSection(sectionEl, shouldShow) {
  if (!sectionEl) return;
  sectionEl.classList.toggle("hidden", !shouldShow);
  sectionEl.querySelectorAll("input, select").forEach((el) => {
    if (!shouldShow) {
      if (el.dataset.preHiddenDisabled === undefined) {
        el.dataset.preHiddenDisabled = el.disabled ? "true" : "false";
      }
      el.disabled = true;
    } else if (el.dataset.preHiddenDisabled !== undefined) {
      el.disabled = el.dataset.preHiddenDisabled === "true";
      delete el.dataset.preHiddenDisabled;
    }
  });
}

function syncOffsetInputs(offset) {
  const x = clamp(offset?.x, 0, 200, DEFAULT_SETTINGS.offset.x);
  const y = clamp(offset?.y, 0, 200, DEFAULT_SETTINGS.offset.y);
  if (offsetX) offsetX.value = x;
  if (offsetSliderX) offsetSliderX.value = x;
  if (offsetY) offsetY.value = y;
  if (offsetSliderY) offsetSliderY.value = y;
}

function syncOpacityInputs(settings) {
  const textOpacity = clamp(settings.opacity, 0, 1, DEFAULT_SETTINGS.opacity);
  const imgOpacity = clamp(settings.imageOpacity, 0, 1, DEFAULT_SETTINGS.imageOpacity);
  if (opacity) opacity.value = textOpacity;
  if (opacitySlider) opacitySlider.value = textOpacity;
  if (imageOpacity) imageOpacity.value = imgOpacity;
  if (imageOpacitySlider) imageOpacitySlider.value = imgOpacity;
}
