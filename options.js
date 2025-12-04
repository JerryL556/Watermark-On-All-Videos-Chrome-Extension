const DEFAULT_SETTINGS = {
  text: "WATERMARKTEST",
  enabled: true,
  contentMode: "text", // text | image | both
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
let previewController;
let saveTimeout;
const SYNC_IMAGE_THRESHOLD = 7000; // chars; store larger images in local to avoid sync quota

document.addEventListener("DOMContentLoaded", initOptions);

function initOptions() {
  cacheElements();
  loadSettings().then((settings) => {
    currentSettings = settings;
    populateForm(settings);
    previewController = new PreviewController(document.getElementById("preview"), settings);
    attachEvents();
  });
}

function cacheElements() {
  const ids = [
    "enabled",
    "text",
    "mode",
    "contentMode",
    "color",
    "opacity",
    "imageOpacity",
    "fontSize",
    "fontFamily",
    "shadow",
    "staticPosition",
    "offsetX",
    "offsetY",
    "imageScaleX",
    "imageScaleY",
    "imageMaintainRatio",
    "randomIntervalMs",
    "bounceSpeed",
    "saveBtn",
    "resetBtn",
    "imageFile",
    "imageStatus",
    "clearImageBtn",
    "imageScaleYWrapper"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      window[id] = el;
    }
  });
}

function attachEvents() {
  const inputs = [
    enabled,
    text,
    mode,
    contentMode,
    color,
    opacity,
    imageOpacity,
    fontSize,
    fontFamily,
    shadow,
    staticPosition,
    offsetX,
    offsetY,
    imageScaleX,
    imageScaleY,
    imageMaintainRatio,
    randomIntervalMs,
    bounceSpeed
  ];

  inputs.forEach((el) => {
    if (!el) return;
    const eventName = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(eventName, handleChange);
  });

  saveBtn?.addEventListener("click", saveSettings);
  imageFile?.addEventListener("change", handleImageUpload);
  clearImageBtn?.addEventListener("click", clearImage);
  resetBtn?.addEventListener("click", () => {
    currentSettings = { ...DEFAULT_SETTINGS, offset: { ...DEFAULT_SETTINGS.offset } };
    populateForm(currentSettings);
    saveSettings();
  });
}

function populateForm(settings) {
  enabled.checked = settings.enabled;
  text.value = settings.text;
  mode.value = settings.mode;
  contentMode.value = settings.contentMode || "text";
  color.value = settings.color;
  opacity.value = settings.opacity;
  imageOpacity.value = settings.imageOpacity;
  fontSize.value = settings.fontSize;
  fontFamily.value = settings.fontFamily;
  shadow.checked = settings.shadow;
  staticPosition.value = settings.staticPosition;
  offsetX.value = settings.offset.x;
  offsetY.value = settings.offset.y;
  imageScaleX.value = settings.imageScaleX;
  imageScaleY.value = settings.imageScaleY;
  imageMaintainRatio.checked = settings.imageMaintainRatio;
  randomIntervalMs.value = settings.randomIntervalMs;
  bounceSpeed.value = settings.bounceSpeed;
  updateImageUI(settings.imageData);
  toggleScaleY(settings.imageMaintainRatio);
}

function handleChange() {
  currentSettings = {
    ...currentSettings,
    enabled: enabled.checked,
    text: text.value || DEFAULT_SETTINGS.text,
    mode: mode.value,
    contentMode: contentMode.value,
    color: color.value || DEFAULT_SETTINGS.color,
    opacity: clampNumber(opacity.value, 0, 1, DEFAULT_SETTINGS.opacity),
    imageOpacity: clampNumber(imageOpacity.value, 0, 1, DEFAULT_SETTINGS.imageOpacity),
    fontSize: clampNumber(fontSize.value, 8, 200, DEFAULT_SETTINGS.fontSize),
    fontFamily: fontFamily.value || DEFAULT_SETTINGS.fontFamily,
    shadow: shadow.checked,
    staticPosition: staticPosition.value,
    offset: {
      x: clampNumber(offsetX.value, 0, 200, DEFAULT_SETTINGS.offset.x),
      y: clampNumber(offsetY.value, 0, 200, DEFAULT_SETTINGS.offset.y)
    },
    imageScaleX: clampNumber(imageScaleX.value, 0.05, 3, DEFAULT_SETTINGS.imageScaleX),
    imageScaleY: clampNumber(imageScaleY.value, 0.05, 3, DEFAULT_SETTINGS.imageScaleY),
    imageMaintainRatio: imageMaintainRatio.checked,
    randomIntervalMs: clampNumber(randomIntervalMs.value, 200, 10000, DEFAULT_SETTINGS.randomIntervalMs),
    bounceSpeed: clampNumber(bounceSpeed.value, 10, 500, DEFAULT_SETTINGS.bounceSpeed)
  };

  toggleScaleY(currentSettings.imageMaintainRatio);
  previewController?.updateSettings(currentSettings);
  queueSave();
}

function handleImageUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    currentSettings = {
      ...currentSettings,
      imageData: reader.result,
      contentMode: currentSettings.contentMode === "text" ? "image" : currentSettings.contentMode
    };
    updateImageUI(reader.result);
    previewController?.updateSettings(currentSettings);
    saveSettings();
  };
  reader.readAsDataURL(file);
}

function clearImage() {
  currentSettings = { ...currentSettings, imageData: "" };
  if (imageFile) imageFile.value = "";
  updateImageUI("");
  previewController?.updateSettings(currentSettings);
  saveSettings();
}

function updateImageUI(imageData) {
  if (!imageStatus) return;
  if (imageData) {
    imageStatus.textContent = "Image loaded";
    imageStatus.style.color = "#34d399";
  } else {
    imageStatus.textContent = "No image";
    imageStatus.style.color = "#94a3b8";
  }
}

function toggleScaleY(keepRatio) {
  if (!imageScaleYWrapper) return;
  imageScaleYWrapper.style.display = keepRatio ? "none" : "inline-flex";
}

function queueSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(saveSettings, 350);
}

function saveSettings() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  persistSettings(currentSettings);
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

function persistSettings(settings) {
  const toSync = { ...settings };
  if (toSync.imageData && toSync.imageData.length > SYNC_IMAGE_THRESHOLD) {
    const { imageData, ...rest } = toSync;
    chrome.storage.local.set({ imageData });
    chrome.storage.sync.set(rest);
  } else {
    chrome.storage.local.remove("imageData");
    chrome.storage.sync.set(toSync);
  }
}

class PreviewController {
  constructor(container, settings) {
    this.container = container;
    this.settings = { ...settings, offset: { ...settings.offset } };
    this.overlay = document.createElement("div");
    this.overlay.className = "wmx-overlay";
    this.overlay.style.position = "absolute";
    this.overlay.style.top = "0";
    this.overlay.style.left = "0";
    this.overlay.style.width = "100%";
    this.overlay.style.height = "100%";
    this.overlay.style.zIndex = "3";
    this.overlay.style.pointerEvents = "none";

    this.markEl = document.createElement("div");
    this.markEl.className = "wmx-mark";
    this.markEl.style.position = "absolute";
    this.markEl.style.whiteSpace = "nowrap";
    this.markEl.style.userSelect = "none";
    this.markEl.style.display = "inline-flex";
    this.markEl.style.alignItems = "center";
    this.markEl.style.gap = "6px";

    this.textEl = document.createElement("div");
    this.textEl.className = "wmx-watermark";
    this.textEl.style.whiteSpace = "nowrap";
    this.textEl.style.userSelect = "none";

    this.imageEl = document.createElement("img");
    this.imageEl.className = "wmx-image";
    this.imageEl.style.objectFit = "contain";
    this.imageEl.style.pointerEvents = "none";

    this.markEl.appendChild(this.textEl);
    this.overlay.appendChild(this.markEl);
    this.container.appendChild(this.overlay);

    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.modeTimer = null;
    this.rafId = null;
    this.bounds = { width: this.container.clientWidth, height: this.container.clientHeight };
    this.applyStyle();
    this.applyMode();
  }

  applyStyle() {
    this.markEl.innerHTML = "";
    const showImage = (this.settings.contentMode === "image" || this.settings.contentMode === "both") && this.settings.imageData;
    const showText = this.settings.contentMode === "text" || this.settings.contentMode === "both";

    if (showImage) {
      this.imageEl.src = this.settings.imageData;
      this.imageEl.style.opacity = this.settings.imageOpacity;
      this.imageEl.onload = () => {
        const naturalW = this.imageEl.naturalWidth || 1;
        const naturalH = this.imageEl.naturalHeight || 1;
        const scaleX = Number(this.settings.imageScaleX) || DEFAULT_SETTINGS.imageScaleX;
        const scaleY = this.settings.imageMaintainRatio
          ? scaleX
          : Number(this.settings.imageScaleY) || DEFAULT_SETTINGS.imageScaleY;
        this.imageEl.style.width = `${naturalW * scaleX}px`;
        this.imageEl.style.height = `${naturalH * scaleY}px`;
        this.applyMode();
      };
      if (this.imageEl.complete) {
        this.imageEl.onload?.();
      }
      this.markEl.appendChild(this.imageEl);
    }

    if (showText) {
      this.textEl.textContent = this.settings.text;
      this.textEl.style.color = this.settings.color;
      this.textEl.style.opacity = this.settings.opacity;
      this.textEl.style.fontSize = `${this.settings.fontSize}px`;
      this.textEl.style.fontFamily = this.settings.fontFamily;
      this.textEl.style.textShadow = this.settings.shadow ? "0 1px 3px rgba(0,0,0,0.45)" : "none";
      this.markEl.appendChild(this.textEl);
    }
  }

  updateSettings(settings) {
    const modeChanged = this.settings.mode !== settings.mode;
    this.settings = { ...settings, offset: { ...settings.offset } };
    this.applyStyle();
    if (modeChanged) {
      this.applyMode();
    }
  }

  stopAnimations() {
    if (this.modeTimer) {
      clearInterval(this.modeTimer);
      this.modeTimer = null;
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  applyMode() {
    this.stopAnimations();
    if (!this.settings.enabled) {
      this.markEl.style.display = "none";
      return;
    }
    this.markEl.style.display = "inline-flex";

    const markRect = this.markEl.getBoundingClientRect();
    const maxX = Math.max(0, this.bounds.width - markRect.width);
    const maxY = Math.max(0, this.bounds.height - markRect.height);

    if (this.settings.mode === "static") {
      this.position = this.getStaticPosition(markRect);
      this.render();
    } else if (this.settings.mode === "random-pop") {
      const randomize = () => {
        this.position = {
          x: Math.random() * maxX,
          y: Math.random() * maxY
        };
        this.render();
      };
      randomize();
      this.modeTimer = setInterval(randomize, Math.max(300, this.settings.randomIntervalMs));
    } else if (this.settings.mode === "bounce") {
      const angle = Math.random() * Math.PI * 2;
      this.velocity = {
        x: Math.cos(angle) * this.settings.bounceSpeed,
        y: Math.sin(angle) * this.settings.bounceSpeed
      };
      this.position = {
        x: Math.random() * maxX,
        y: Math.random() * maxY
      };
      let last = performance.now();
      const tick = (now) => {
        const dt = (now - last) / 1000;
        last = now;
        let nextX = this.position.x + this.velocity.x * dt;
        let nextY = this.position.y + this.velocity.y * dt;
        if (nextX <= 0 || nextX >= maxX) this.velocity.x *= -1;
        if (nextY <= 0 || nextY >= maxY) this.velocity.y *= -1;
        this.position.x = clampNumber(nextX, 0, maxX, nextX);
        this.position.y = clampNumber(nextY, 0, maxY, nextY);
        this.render();
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }
  }

  getStaticPosition(markRect) {
    const { staticPosition, offset } = this.settings;
    switch (staticPosition) {
      case "top-right":
        return { x: this.bounds.width - markRect.width - offset.x, y: offset.y };
      case "bottom-left":
        return { x: offset.x, y: this.bounds.height - markRect.height - offset.y };
      case "bottom-right":
        return { x: this.bounds.width - markRect.width - offset.x, y: this.bounds.height - markRect.height - offset.y };
      case "center":
        return { x: (this.bounds.width - markRect.width) / 2, y: (this.bounds.height - markRect.height) / 2 };
      case "top-left":
      default:
        return { x: offset.x, y: offset.y };
    }
  }

  render() {
    this.markEl.style.transform = `translate(${this.position.x}px, ${this.position.y}px)`;
  }
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(Math.max(num, min), max);
}
