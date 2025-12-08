const DEFAULT_SETTINGS = {
  text: "WATERMARKTEST",
  enabled: true,
  contentMode: "text", // text | image | both
  mode: "static", // static | random-pop | bounce
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
  bounceSpeed: 80, // pixels per second
  shadow: true,
  hdrEnabled: false,
  hdrStrength: 0.6,
  hdrSpecularLift: 0.25,
  hdrLocalContrast: 0.2,
  hdrVibrance: 0.18,
  hdrSaturationGuard: true,
  hdrExposure: 1,
  debug: false
};

// Holds merged user settings so controllers can read without reloading storage.
let currentSettings = { ...DEFAULT_SETTINGS };
// Map video elements to their watermark controller to avoid duplicate overlays.
const controllers = new Map();
let mutationObserver;
let locationWatcher;

init();

async function init() {
  currentSettings = await loadSettings();
  setupStorageListener();
  setupGlobalListeners();
  scanForVideos();
  setupMutationObserver();
  setupLocationWatcher();
}

function logDebug(...args) {
  if (currentSettings.debug) {
    console.log("[wmx]", ...args);
  }
}

function loadSettings() {
  return new Promise((resolve) => {
    try {
      const mergeSettings = (syncItems, localItems) => {
        const merged = { ...DEFAULT_SETTINGS, ...syncItems };
        // Prefer local imageData if present to avoid sync quota issues
        if (localItems && localItems.imageData) {
          merged.imageData = localItems.imageData;
        }
        resolve(merged);
      };

      // Pull sync + local in parallel; chrome.storage lacks a Promise API here.
      chrome.storage.sync.get(DEFAULT_SETTINGS, (syncItems) => {
        chrome.storage.local.get(["imageData"], (localItems) => {
          mergeSettings(syncItems, localItems);
        });
      });
    } catch (err) {
      console.warn("wmx: storage unavailable, using defaults", err);
      resolve({ ...DEFAULT_SETTINGS });
    }
  });
}

function setupStorageListener() {
  if (!chrome.storage || !chrome.storage.onChanged) return;
  // Mirror remote sync changes into current controllers without page reloads.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    let updated = false;
    Object.keys(changes).forEach((key) => {
      currentSettings[key] = changes[key].newValue;
      updated = true;
    });
    if (updated) {
      controllers.forEach((controller) => controller.updateSettings(currentSettings));
    }
  });
}

function setupGlobalListeners() {
  // Keep overlay position/visibility in sync with viewport changes.
  const onViewportChange = () => {
    controllers.forEach((controller) => controller.updateBounds());
  };
  window.addEventListener("resize", onViewportChange, { passive: true });
  window.addEventListener("scroll", onViewportChange, { passive: true });
  document.addEventListener("fullscreenchange", onViewportChange);

  // Pause animations when the tab is hidden to reduce work.
  document.addEventListener("visibilitychange", () => {
    controllers.forEach((controller) => controller.handleVisibility(document.visibilityState === "visible"));
  });
}

function setupMutationObserver() {
  // Watch for SPA DOM changes so we attach overlays to videos that appear later.
  mutationObserver = new MutationObserver(() => {
    scanForVideos();
  });
  mutationObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

function setupLocationWatcher() {
  let lastHref = location.href;
  // Some sites swap videos via history.pushState; poll for URL changes to rescan.
  locationWatcher = window.setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      logDebug("Location changed, rescanning videos");
      scanForVideos(true);
    }
  }, 800);
}

function scanForVideos(force = false) {
  // Create controllers for new videos and drop ones that left the DOM.
  const videos = Array.from(document.getElementsByTagName("video"));
  videos.forEach((video) => {
    if (!controllers.has(video)) {
      controllers.set(video, new WatermarkController(video, currentSettings));
    } else if (force) {
      const controller = controllers.get(video);
      controller.updateBounds();
      controller.updateSettings(currentSettings);
    }
  });

  controllers.forEach((controller, video) => {
    if (!video.isConnected) {
      controller.destroy();
      controllers.delete(video);
    }
  });
}

// Manages a single overlay attached to a video element.
class WatermarkController {
  constructor(video, settings) {
    this.video = video;
    this.settings = { ...settings, offset: { ...settings.offset } };
    this.overlay = null;
    this.markEl = null;
    this.textEl = null;
    this.imageEl = null;
    this.baseFilter = "";
    this.bounds = { width: 0, height: 0 };
    this.position = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.modeTimer = null;
    this.rafId = null;
    this.resizeObserver = null;
    this.boundMetadataHandler = this.updateBounds.bind(this);
    this.boundPlayHandler = this.handlePlaybackChange.bind(this, true);
    this.boundPauseHandler = this.handlePlaybackChange.bind(this, false);
    this.init();
  }

  init() {
    this.createOverlay();
    this.bindEvents();
    this.refreshContent();
    this.updateBounds();
    this.applyMode();
    logDebug("Overlay attached to video", this.video);
  }

  createOverlay() {
    this.overlay = document.createElement("div");
    this.overlay.className = "wmx-overlay";
    this.markEl = document.createElement("div");
    this.markEl.className = "wmx-mark";
    this.textEl = document.createElement("div");
    this.textEl.className = "wmx-watermark";
    this.imageEl = document.createElement("img");
    this.imageEl.className = "wmx-image";
    this.imageEl.addEventListener("load", () => {
      this.updateBounds();
      this.applyMode();
    });
    this.overlay.appendChild(this.markEl);
    document.body.appendChild(this.overlay);
    this.applyStyle();
  }

  bindEvents() {
    this.video.addEventListener("loadedmetadata", this.boundMetadataHandler);
    this.video.addEventListener("loadeddata", this.boundMetadataHandler);
    this.video.addEventListener("emptied", this.boundMetadataHandler);
    this.video.addEventListener("play", this.boundPlayHandler);
    this.video.addEventListener("playing", this.boundPlayHandler);
    this.video.addEventListener("pause", this.boundPauseHandler);
    this.video.addEventListener("ended", this.boundPauseHandler);

    if (typeof ResizeObserver !== "undefined") {
      // Keep overlay sized to dynamic video layouts (responsive players, PiP toggles).
      this.resizeObserver = new ResizeObserver(() => this.updateBounds());
      this.resizeObserver.observe(this.video);
    }
  }

  applyStyle() {
    this.refreshContent();

    if (this.settings.enabled) {
      this.overlay?.classList.remove("wmx-hidden");
    } else {
      this.overlay?.classList.add("wmx-hidden");
    }
    this.applyHdrEffect();
  }

  refreshContent() {
    if (!this.markEl) return;
    this.markEl.innerHTML = "";

    const showImage = (this.settings.contentMode === "image" || this.settings.contentMode === "both") && this.settings.imageData;
    const showText = this.settings.contentMode === "text" || this.settings.contentMode === "both";

    if (showImage && this.imageEl) {
      // Keep image sizing tied to natural dimensions so scale sliders feel predictable.
      this.imageEl.src = this.settings.imageData;
      this.imageEl.style.opacity = String(this.settings.imageOpacity);
      this.imageEl.style.width = "";
      this.imageEl.style.height = "";
      this.imageEl.style.transform = "";
      this.imageEl.style.objectFit = "contain";
      this.markEl.appendChild(this.imageEl);

      const handleSize = () => {
        const naturalW = this.imageEl.naturalWidth || 1;
        const naturalH = this.imageEl.naturalHeight || 1;
        const scaleX = Number(this.settings.imageScaleX) || DEFAULT_SETTINGS.imageScaleX;
        const scaleY = this.settings.imageMaintainRatio
          ? scaleX
          : Number(this.settings.imageScaleY) || DEFAULT_SETTINGS.imageScaleY;
        this.imageEl.style.width = `${naturalW * scaleX}px`;
        this.imageEl.style.height = `${naturalH * scaleY}px`;
      };
      if (this.imageEl.complete) {
        handleSize();
      } else {
        this.imageEl.onload = handleSize;
      }
    }

    if (showText && this.textEl) {
      this.textEl.style.color = this.settings.color;
      this.textEl.style.opacity = String(this.settings.opacity);
      this.textEl.style.fontSize = `${this.settings.fontSize}px`;
      this.textEl.style.fontFamily = this.settings.fontFamily;
      this.textEl.style.textShadow = this.settings.shadow
        ? "0 1px 3px rgba(0,0,0,0.45)"
        : "none";
      this.textEl.textContent = this.settings.text;
      this.markEl.appendChild(this.textEl);
    }
  }

  updateSettings(settings) {
    this.settings = { ...settings, offset: { ...settings.offset } };
    this.applyStyle();
    this.applyHdrEffect();
    this.applyMode();
    this.updateBounds();
  }

  updateBounds() {
    if (!this.overlay || !this.video.isConnected) return;
    // Mirror the overlay to the video’s on-screen box, accounting for scroll offsets.
    const rect = this.video.getBoundingClientRect();
    const scrollX = window.scrollX || document.documentElement.scrollLeft || 0;
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;

    this.bounds = { width: rect.width, height: rect.height };
    this.overlay.style.width = `${rect.width}px`;
    this.overlay.style.height = `${rect.height}px`;
    this.overlay.style.transform = `translate(${rect.left + scrollX}px, ${rect.top + scrollY}px)`;

    this.constrainPosition();
    this.renderPosition();
  }

  constrainPosition() {
    if (!this.markEl) return;
    const markRect = this.markEl.getBoundingClientRect();
    const maxX = Math.max(0, this.bounds.width - markRect.width);
    const maxY = Math.max(0, this.bounds.height - markRect.height);
    this.position.x = clamp(this.position.x, 0, maxX);
    this.position.y = clamp(this.position.y, 0, maxY);
  }

  renderPosition() {
    if (!this.markEl) return;
    this.markEl.style.transform = `translate(${this.position.x}px, ${this.position.y}px)`;
  }

  applyMode() {
    // Switch behavior based on placement mode; pause animations when disabled.
    this.stopAnimations();
    if (!this.settings.enabled) {
      this.overlay?.classList.add("wmx-hidden");
      this.applyHdrEffect(true);
      return;
    }
    this.overlay?.classList.remove("wmx-hidden");

    if (this.settings.mode === "static") {
      this.applyStaticPosition();
    } else if (this.settings.mode === "random-pop") {
      this.applyRandomPop();
    } else if (this.settings.mode === "bounce") {
      this.applyBounce();
    }
  }

  applyStaticPosition() {
    const { staticPosition, offset } = this.settings;
    const markRect = this.markEl.getBoundingClientRect();
    let x = 0;
    let y = 0;

    switch (staticPosition) {
      case "top-right":
        x = this.bounds.width - markRect.width - offset.x;
        y = offset.y;
        break;
      case "bottom-left":
        x = offset.x;
        y = this.bounds.height - markRect.height - offset.y;
        break;
      case "bottom-right":
        x = this.bounds.width - markRect.width - offset.x;
        y = this.bounds.height - markRect.height - offset.y;
        break;
      case "center":
        x = (this.bounds.width - markRect.width) / 2;
        y = (this.bounds.height - markRect.height) / 2;
        break;
      case "top-left":
      default:
        x = offset.x;
        y = offset.y;
    }

    this.position = { x, y };
    this.constrainPosition();
    this.renderPosition();
  }

  applyRandomPop() {
    // Jump to random positions at the configured interval.
    const randomize = () => {
      const markRect = this.markEl.getBoundingClientRect();
      const maxX = Math.max(0, this.bounds.width - markRect.width);
      const maxY = Math.max(0, this.bounds.height - markRect.height);
      this.position = {
        x: Math.random() * maxX,
        y: Math.random() * maxY
      };
      this.renderPosition();
    };

    randomize();
    if (!this.canAnimate()) return;

    const interval = Math.max(300, Number(this.settings.randomIntervalMs) || DEFAULT_SETTINGS.randomIntervalMs);
    this.modeTimer = window.setInterval(randomize, interval);
  }

  applyBounce() {
    // Simple velocity-based bounce that reflects off overlay bounds.
    const markRect = this.markEl.getBoundingClientRect();
    const markWidth = markRect.width;
    const markHeight = markRect.height;
    const maxX = Math.max(0, this.bounds.width - markWidth);
    const maxY = Math.max(0, this.bounds.height - markHeight);
    this.position = {
      x: clamp(this.position.x || Math.random() * maxX, 0, maxX),
      y: clamp(this.position.y || Math.random() * maxY, 0, maxY)
    };

    const angle = Math.random() * Math.PI * 2;
    const speed = Math.max(10, Number(this.settings.bounceSpeed) || DEFAULT_SETTINGS.bounceSpeed);
    this.velocity = {
      x: Math.cos(angle) * speed,
      y: Math.sin(angle) * speed
    };

    let lastTime = performance.now();
    this.renderPosition();
    if (!this.canAnimate()) {
      return;
    }

    const tick = (now) => {
      if (!this.settings.enabled) return;
      const deltaMs = now - lastTime;
      lastTime = now;
      const delta = deltaMs / 1000;

      const nextX = this.position.x + this.velocity.x * delta;
      const nextY = this.position.y + this.velocity.y * delta;

      const currentRect = this.markEl.getBoundingClientRect();
      const curW = currentRect.width || markWidth;
      const curH = currentRect.height || markHeight;
      const maxX = Math.max(0, this.bounds.width - curW);
      const maxY = Math.max(0, this.bounds.height - curH);

      if (nextX <= 0 || nextX >= maxX) {
        this.velocity.x *= -1;
      }
      if (nextY <= 0 || nextY >= maxY) {
        this.velocity.y *= -1;
      }

      this.position.x = clamp(nextX, 0, maxX);
      this.position.y = clamp(nextY, 0, maxY);
      this.renderPosition();

      if (document.visibilityState !== "visible") {
        lastTime = performance.now();
      }

      this.rafId = window.requestAnimationFrame(tick);
    };

    this.rafId = window.requestAnimationFrame(tick);
  }

  handleVisibility(isVisible) {
    if (!isVisible) {
      this.stopAnimations();
      return;
    }
    if (!this.canAnimate()) return;
    if (this.settings.mode === "bounce" && !this.rafId) {
      this.applyBounce();
    } else if (this.settings.mode === "random-pop" && !this.modeTimer) {
      this.applyRandomPop();
    }
  }

  handlePlaybackChange(isPlaying) {
    if (!isPlaying) {
      this.stopAnimations();
      return;
    }
    this.applyMode();
  }

  canAnimate() {
    return this.settings.enabled && this.video && !this.video.paused && !this.video.ended;
  }

  stopAnimations() {
    if (this.modeTimer) {
      window.clearInterval(this.modeTimer);
      this.modeTimer = null;
    }
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  applyHdrEffect(forceDisable = false) {
    if (!this.video) return;
    // Cache any existing filter so we can restore it when HDR is toggled.
    if (!this.baseFilter) {
      const inlineFilter = this.video.style.filter;
      const computedFilter = getComputedStyle(this.video).filter;
      this.baseFilter = inlineFilter || computedFilter || "none";
    }

    const hdrActive = this.settings.enabled && this.settings.hdrEnabled && !forceDisable;
    if (!hdrActive) {
      this.video.style.filter = this.baseFilter === "none" ? "" : this.baseFilter;
      return;
    }

    const strength = clamp(Number(this.settings.hdrStrength), 0, 1, DEFAULT_SETTINGS.hdrStrength);
    const exposure = clamp(
      Number(this.settings.hdrExposure),
      0.7,
      1.3,
      DEFAULT_SETTINGS.hdrExposure
    );
    const specular = clamp(
      Number(this.settings.hdrSpecularLift),
      0,
      0.6,
      DEFAULT_SETTINGS.hdrSpecularLift
    );
    const localContrast = clamp(
      Number(this.settings.hdrLocalContrast),
      0,
      0.6,
      DEFAULT_SETTINGS.hdrLocalContrast
    );
    const vibrance = clamp(Number(this.settings.hdrVibrance), 0, 0.6, DEFAULT_SETTINGS.hdrVibrance);
    const saturationGuard = Boolean(this.settings.hdrSaturationGuard);

    const contrastBoost = 1 + localContrast * strength * 1.2 + specular * strength * 0.25;
    const brightnessBoost = clamp(
      (0.94 + specular * strength * 0.22 + localContrast * strength * 0.04) * exposure,
      0.85,
      1.2
    );
    const saturationBoost = 1 + vibrance * strength * (saturationGuard ? 0.7 : 1);
    const highlightsBloom = Math.min(10, 5 + strength * 10);
    const glowAlpha = Math.min(0.22, 0.08 + specular * 0.25);

    const hdrFilter = [
      `contrast(${contrastBoost.toFixed(3)})`,
      `brightness(${brightnessBoost.toFixed(3)})`,
      `saturate(${saturationBoost.toFixed(3)})`,
      `drop-shadow(0 0 ${highlightsBloom.toFixed(1)}px rgba(255,255,255,${glowAlpha.toFixed(3)}))`
    ].join(" ");

    const baseFilter = this.baseFilter === "none" ? "" : this.baseFilter;
    this.video.style.filter = `${baseFilter} ${hdrFilter}`.trim();
  }

  restoreBaseFilter() {
    if (this.video) {
      this.video.style.filter = this.baseFilter === "none" ? "" : this.baseFilter;
    }
  }

  destroy() {
    this.stopAnimations();
    this.video.removeEventListener("loadedmetadata", this.boundMetadataHandler);
    this.video.removeEventListener("loadeddata", this.boundMetadataHandler);
    this.video.removeEventListener("emptied", this.boundMetadataHandler);
    this.video.removeEventListener("play", this.boundPlayHandler);
    this.video.removeEventListener("playing", this.boundPlayHandler);
    this.video.removeEventListener("pause", this.boundPauseHandler);
    this.video.removeEventListener("ended", this.boundPauseHandler);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.overlay && this.overlay.parentElement) {
      this.overlay.parentElement.removeChild(this.overlay);
    }
    this.restoreBaseFilter();
  }
}

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback !== undefined ? fallback : min;
  return Math.min(Math.max(num, min), max);
}
