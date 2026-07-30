(function (global) {
  "use strict";

  const VERSION = "1.0.0";
  const COLS = 8;
  const ROWS = 11;

  const idleFrames = [
    [0, 0, 1680],
    [0, 1, 660],
    [0, 2, 660],
    [0, 3, 840],
    [0, 4, 840],
    [0, 5, 1920],
  ];

  function rowFrames(row, count, duration, lastDuration) {
    return Array.from({ length: count }, (_, column) => [
      row,
      column,
      column === count - 1 ? lastDuration : duration,
    ]);
  }

  const DEFAULT_STATES = Object.freeze({
    idle: { label: "待机", frames: idleFrames },
    "running-right": { label: "向右跑", frames: rowFrames(1, 8, 120, 220) },
    "running-left": { label: "向左跑", frames: rowFrames(2, 8, 120, 220) },
    waving: { label: "挥手", frames: rowFrames(3, 4, 140, 280) },
    jumping: { label: "跳跃", frames: rowFrames(4, 5, 140, 280) },
    failed: { label: "失败", frames: rowFrames(5, 8, 140, 240) },
    waiting: { label: "等待", frames: rowFrames(6, 6, 150, 260) },
    running: { label: "工作中", frames: rowFrames(7, 6, 120, 220) },
    review: { label: "审查", frames: rowFrames(8, 6, 150, 280) },
  });

  const DEFAULTS = Object.freeze({
    id: null,
    spriteSheet: "assets/codex-spritesheet.webp",
    columns: COLS,
    rows: ROWS,
    cellWidth: 192,
    cellHeight: 208,
    width: 128,
    height: null,
    initialState: "idle",
    states: DEFAULT_STATES,
    position: { right: 24, bottom: 24 },
    zIndex: 2147483000,
    draggable: true,
    keepInViewport: true,
    persistPosition: true,
    persistenceKey: "web-pet-position",
    clickAction: "toggle-playback",
    followCursor: false,
    lookDeadzone: 6,
    imageRendering: "pixelated",
    shadow: "drop-shadow(0 14px 14px rgba(0, 0, 0, 0.28))",
    cursor: "grab",
    className: "",
    ariaLabel: "网页宠物",
    onClick: null,
    onStateChange: null,
    onMove: null,
  });

  const EASINGS = Object.freeze({
    linear: (t) => t,
    easeOut: (t) => 1 - Math.pow(1 - t, 3),
    easeInOut: (t) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  });

  let instanceCounter = 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function numberOr(value, fallback) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  }

  function normalizeFrame(frame) {
    if (Array.isArray(frame)) {
      return {
        row: numberOr(frame[0], 0),
        column: numberOr(frame[1], 0),
        duration: Math.max(16, numberOr(frame[2], 120)),
      };
    }
    return {
      row: numberOr(frame.row ?? frame.rowIndex, 0),
      column: numberOr(frame.column ?? frame.columnIndex, 0),
      duration: Math.max(
        16,
        numberOr(frame.duration ?? frame.frameDurationMs, 120),
      ),
    };
  }

  function normalizeStates(states) {
    const normalized = {};
    for (const [name, definition] of Object.entries(states || {})) {
      const rawFrames = Array.isArray(definition) ? definition : definition.frames;
      if (!Array.isArray(rawFrames) || rawFrames.length === 0) continue;
      normalized[name] = {
        label: definition.label || name,
        frames: rawFrames.map(normalizeFrame),
      };
    }
    if (Object.keys(normalized).length === 0) {
      throw new Error("WebPet: states 至少需要一个包含 frames 的状态。");
    }
    return normalized;
  }

  function resolveAssetUrl(url) {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return String(url);
    }
  }

  function createElement(tag, attributes = {}) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
      if (key === "className") element.className = value;
      else element.setAttribute(key, value);
    }
    return element;
  }

  class Pet {
    constructor(options = {}) {
      instanceCounter += 1;
      this.id = options.id || `web-pet-${instanceCounter}`;
      this.config = {
        ...DEFAULTS,
        ...options,
        position: { ...DEFAULTS.position, ...(options.position || {}) },
      };
      this.config.states = normalizeStates(options.states || DEFAULT_STATES);
      this._state = this.config.states[this.config.initialState]
        ? this.config.initialState
        : Object.keys(this.config.states)[0];
      this._frameIndex = 0;
      this._forcedFrame = null;
      this._paused = false;
      this._visible = true;
      this._timer = null;
      this._motionFrame = null;
      this._motionReject = null;
      this._drag = null;
      this._position = { x: 0, y: 0 };
      this._destroyed = false;
      this._events = new EventTarget();
      this._boundResize = () => this._handleViewportResize();
      this._boundCursor = (event) => {
        if (!this._drag && this.config.followCursor) {
          this.lookAt(event.clientX, event.clientY);
        }
      };

      this._buildDom(options.mount);
      this._restoreOrSetInitialPosition();
      this._bindEvents();
      this._renderFrame();
      this._scheduleFrame();
      this._emit("ready", this.snapshot());

      this.animation = Object.freeze({
        play: () => this.play(),
        pause: () => this.pause(),
        toggle: () => this.toggle(),
        setState: (name, settings) => this.setState(name, settings),
        setFrame: (row, column) => this.setFrame(row, column),
        clearFrame: () => this.clearFrame(),
      });

      this.motion = Object.freeze({
        moveTo: (x, y, settings) => this.moveTo(x, y, settings),
        moveBy: (dx, dy, settings) => this.moveBy(dx, dy, settings),
        walkTo: (x, y, settings) => this.walkTo(x, y, settings),
        jump: (settings) => this.jump(settings),
        stop: () => this.stopMotion(),
      });
    }

    get state() {
      return this._state;
    }

    set state(value) {
      this.setState(value);
    }

    get paused() {
      return this._paused;
    }

    get visible() {
      return this._visible;
    }

    get position() {
      return { ...this._position };
    }

    get element() {
      return this.host;
    }

    get states() {
      return Object.keys(this.config.states);
    }

    _buildDom(mountTarget) {
      const mount =
        typeof mountTarget === "string"
          ? document.querySelector(mountTarget)
          : mountTarget || document.body || document.documentElement;
      if (!mount) throw new Error("WebPet: 找不到挂载节点。");

      this.host = createElement("div", {
        "data-web-pet-host": this.id,
        "aria-label": this.config.ariaLabel,
        role: "img",
      });
      if (this.config.className) this.host.className = this.config.className;
      this.host.style.position = "fixed";
      this.host.style.left = "0";
      this.host.style.top = "0";
      this.host.style.zIndex = String(this.config.zIndex);
      this.host.style.width = `${this.config.width}px`;
      this.host.style.height = `${this._resolvedHeight()}px`;
      this.host.style.pointerEvents = "auto";
      this.host.style.touchAction = "none";
      this.host.style.contain = "layout style paint";
      this.host.style.willChange = "left, top";

      this.shadowRoot = this.host.attachShadow({ mode: "open" });
      const style = createElement("style");
      style.textContent = `
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        .pet-hitbox {
          width: 100%;
          height: 100%;
          cursor: var(--web-pet-cursor, grab);
          touch-action: none;
          user-select: none;
          -webkit-user-drag: none;
        }
        .pet-hitbox.dragging { cursor: grabbing; }
        .pet-sprite {
          width: 100%;
          height: 100%;
          background-repeat: no-repeat;
          transform-origin: 50% 88%;
          transition: filter 140ms ease, transform 120ms ease;
          pointer-events: none;
        }
        .pet-hitbox.dragging .pet-sprite { transform: scale(0.985); }
        @media (prefers-reduced-motion: reduce) {
          .pet-sprite { transition: none; }
        }
      `;
      this.hitbox = createElement("div", { className: "pet-hitbox" });
      this.sprite = createElement("div", { className: "pet-sprite" });
      this.hitbox.append(this.sprite);
      this.shadowRoot.append(style, this.hitbox);
      mount.append(this.host);
      this._applySpriteStyles();
    }

    _applySpriteStyles() {
      this.host.style.setProperty("--web-pet-cursor", this.config.cursor);
      this.sprite.style.backgroundImage = `url("${resolveAssetUrl(this.config.spriteSheet)}")`;
      this.sprite.style.backgroundSize = `${this.config.columns * 100}% ${this.config.rows * 100}%`;
      this.sprite.style.imageRendering = this.config.imageRendering;
      this.sprite.style.filter = this.config.shadow;
    }

    _resolvedHeight() {
      if (this.config.height != null) return numberOr(this.config.height, 100);
      return (
        numberOr(this.config.width, 128) *
        (numberOr(this.config.cellHeight, 208) /
          numberOr(this.config.cellWidth, 192))
      );
    }

    _bindEvents() {
      this.hitbox.addEventListener("pointerdown", (event) => this._startDrag(event));
      this.hitbox.addEventListener("pointermove", (event) => this._moveDrag(event));
      this.hitbox.addEventListener("pointerup", (event) => this._endDrag(event));
      this.hitbox.addEventListener("pointercancel", (event) => this._endDrag(event));
      this.hitbox.addEventListener("contextmenu", (event) => event.preventDefault());
      window.addEventListener("resize", this._boundResize);
      document.addEventListener("pointermove", this._boundCursor, { passive: true });
    }

    _startDrag(event) {
      if (!this.config.draggable || event.button !== 0) return;
      event.preventDefault();
      this.stopMotion();
      this.hitbox.setPointerCapture?.(event.pointerId);
      this._drag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: this._position.x,
        startY: this._position.y,
        moved: false,
      };
      this.hitbox.classList.add("dragging");
      this._emit("dragstart", this.snapshot());
    }

    _moveDrag(event) {
      const drag = this._drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (Math.abs(dx) >= 3 || Math.abs(dy) >= 3) drag.moved = true;
      if (!drag.moved) return;
      this.setPosition(drag.startX + dx, drag.startY + dy, { persist: false });
    }

    _endDrag(event) {
      const drag = this._drag;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const moved = drag.moved;
      this._drag = null;
      this.hitbox.classList.remove("dragging");
      if (this.hitbox.hasPointerCapture?.(event.pointerId)) {
        this.hitbox.releasePointerCapture?.(event.pointerId);
      }
      this._persistPosition();
      this._emit("dragend", this.snapshot());
      if (!moved) this._handleClick(event);
    }

    _handleClick(sourceEvent) {
      if (this.config.clickAction === "toggle-playback") this.toggle();
      if (typeof this.config.onClick === "function") {
        this.config.onClick(this, sourceEvent);
      }
      this._emit("click", { pet: this, sourceEvent });
    }

    _restoreOrSetInitialPosition() {
      let stored = null;
      if (this.config.persistPosition) {
        try {
          stored = JSON.parse(localStorage.getItem(this.config.persistenceKey));
        } catch {
          stored = null;
        }
      }
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
        this.setPosition(stored.x, stored.y, { persist: false });
        return;
      }
      const width = this.host.offsetWidth || this.config.width;
      const height = this.host.offsetHeight || this._resolvedHeight();
      const p = this.config.position;
      const x = Number.isFinite(p.x)
        ? p.x
        : Number.isFinite(p.left)
          ? p.left
          : window.innerWidth - width - numberOr(p.right, 24);
      const y = Number.isFinite(p.y)
        ? p.y
        : Number.isFinite(p.top)
          ? p.top
          : window.innerHeight - height - numberOr(p.bottom, 24);
      this.setPosition(x, y, { persist: false });
    }

    _safePosition(x, y) {
      if (!this.config.keepInViewport) return { x, y };
      const width = this.host.offsetWidth || this.config.width;
      const height = this.host.offsetHeight || this._resolvedHeight();
      return {
        x: clamp(x, 0, Math.max(0, window.innerWidth - width)),
        y: clamp(y, 0, Math.max(0, window.innerHeight - height)),
      };
    }

    _handleViewportResize() {
      const safe = this._safePosition(this._position.x, this._position.y);
      this.setPosition(safe.x, safe.y, { persist: true });
    }

    _persistPosition() {
      if (!this.config.persistPosition) return;
      try {
        localStorage.setItem(this.config.persistenceKey, JSON.stringify(this._position));
      } catch {
        // localStorage 可能被页面策略禁用，不影响 Pet 继续运行。
      }
    }

    _scheduleFrame() {
      if (this._destroyed || this._paused || this._forcedFrame) return;
      const frames = this.config.states[this._state].frames;
      const frame = frames[this._frameIndex];
      this._timer = window.setTimeout(() => {
        this._frameIndex = (this._frameIndex + 1) % frames.length;
        this._renderFrame();
        this._scheduleFrame();
      }, frame.duration);
    }

    _renderFrame() {
      const frame =
        this._forcedFrame || this.config.states[this._state].frames[this._frameIndex];
      const columnDenominator = Math.max(1, this.config.columns - 1);
      const rowDenominator = Math.max(1, this.config.rows - 1);
      this.sprite.style.backgroundPosition = `${(frame.column / columnDenominator) * 100}% ${(frame.row / rowDenominator) * 100}%`;
      this.sprite.dataset.state = this._state;
      this.sprite.dataset.row = String(frame.row);
      this.sprite.dataset.column = String(frame.column);
      this.sprite.dataset.frame = String(this._frameIndex);
      this._emit("frame", {
        state: this._state,
        frameIndex: this._frameIndex,
        frame: { ...frame },
      });
    }

    _restartTimer() {
      if (this._timer) window.clearTimeout(this._timer);
      this._timer = null;
      this._renderFrame();
      this._scheduleFrame();
    }

    _emit(type, detail) {
      this._events.dispatchEvent(new CustomEvent(type, { detail }));
    }

    on(type, listener) {
      const wrapped = (event) => listener(event.detail);
      this._events.addEventListener(type, wrapped);
      return () => this._events.removeEventListener(type, wrapped);
    }

    setState(name, { restart = true } = {}) {
      if (!this.config.states[name]) {
        throw new Error(`WebPet: 未定义状态 "${name}"。`);
      }
      const changed = name !== this._state;
      this._state = name;
      this._forcedFrame = null;
      if (restart || changed) this._frameIndex = 0;
      this._restartTimer();
      if (typeof this.config.onStateChange === "function") {
        this.config.onStateChange(name, this);
      }
      this._emit("statechange", this.snapshot());
      return this;
    }

    play() {
      if (!this._paused) return this;
      this._paused = false;
      this._scheduleFrame();
      this._emit("play", this.snapshot());
      return this;
    }

    pause() {
      if (this._paused) return this;
      this._paused = true;
      if (this._timer) window.clearTimeout(this._timer);
      this._timer = null;
      this._emit("pause", this.snapshot());
      return this;
    }

    toggle() {
      return this._paused ? this.play() : this.pause();
    }

    setFrame(row, column) {
      this._forcedFrame = {
        row: numberOr(row, 0),
        column: numberOr(column, 0),
        duration: 0,
      };
      if (this._timer) window.clearTimeout(this._timer);
      this._timer = null;
      this._renderFrame();
      return this;
    }

    clearFrame() {
      this._forcedFrame = null;
      this._restartTimer();
      return this;
    }

    lookAt(clientX, clientY) {
      if (this.config.rows < 11) return this;
      const rect = this.host.getBoundingClientRect();
      const dx = clientX - (rect.left + rect.width / 2);
      const dy = clientY - (rect.top + rect.height / 2);
      if (Math.hypot(dx, dy) <= this.config.lookDeadzone) {
        return this.clearFrame();
      }
      const angle = (Math.atan2(dx, -dy) * (180 / Math.PI) + 360) % 360;
      const direction = Math.round(angle / 22.5) % 16;
      return this.setFrame(9 + Math.floor(direction / 8), direction % 8);
    }

    clearLook() {
      return this.clearFrame();
    }

    setPosition(x, y, { persist = true } = {}) {
      const safe = this._safePosition(numberOr(x, 0), numberOr(y, 0));
      this._position = safe;
      this.host.style.left = `${safe.x}px`;
      this.host.style.top = `${safe.y}px`;
      if (persist) this._persistPosition();
      if (typeof this.config.onMove === "function") this.config.onMove(safe, this);
      this._emit("move", this.snapshot());
      return this;
    }

    moveTo(x, y, { duration = 500, easing = "easeOut" } = {}) {
      this.stopMotion();
      const start = { ...this._position };
      const target = this._safePosition(numberOr(x, start.x), numberOr(y, start.y));
      const ease = typeof easing === "function" ? easing : EASINGS[easing] || EASINGS.easeOut;
      if (duration <= 0) {
        this.setPosition(target.x, target.y);
        return Promise.resolve(this);
      }

      return new Promise((resolve, reject) => {
        this._motionReject = reject;
        const startedAt = performance.now();
        const tick = (now) => {
          const progress = clamp((now - startedAt) / duration, 0, 1);
          const value = ease(progress);
          this.setPosition(
            start.x + (target.x - start.x) * value,
            start.y + (target.y - start.y) * value,
            { persist: false },
          );
          if (progress < 1) {
            this._motionFrame = requestAnimationFrame(tick);
            return;
          }
          this._motionFrame = null;
          this._motionReject = null;
          this._persistPosition();
          resolve(this);
        };
        this._motionFrame = requestAnimationFrame(tick);
      });
    }

    moveBy(dx, dy, settings) {
      return this.moveTo(this._position.x + dx, this._position.y + dy, settings);
    }

    async walkTo(
      x,
      y,
      { duration = 900, easing = "linear", restoreState = true } = {},
    ) {
      const previous = this._state;
      const targetX = numberOr(x, this._position.x);
      const direction = targetX < this._position.x ? "running-left" : "running-right";
      if (this.config.states[direction]) this.setState(direction);
      try {
        await this.moveTo(targetX, y, { duration, easing });
      } finally {
        if (restoreState && this.config.states[previous]) this.setState(previous);
      }
      return this;
    }

    jump({ height = 70, duration = 620 } = {}) {
      this.stopMotion();
      const start = { ...this._position };
      const previous = this._state;
      if (this.config.states.jumping) this.setState("jumping");
      return new Promise((resolve, reject) => {
        this._motionReject = reject;
        const startedAt = performance.now();
        const tick = (now) => {
          const progress = clamp((now - startedAt) / duration, 0, 1);
          const lift = Math.sin(progress * Math.PI) * height;
          this.setPosition(start.x, start.y - lift, { persist: false });
          if (progress < 1) {
            this._motionFrame = requestAnimationFrame(tick);
            return;
          }
          this._motionFrame = null;
          this._motionReject = null;
          this.setPosition(start.x, start.y, { persist: true });
          if (this.config.states[previous]) this.setState(previous);
          resolve(this);
        };
        this._motionFrame = requestAnimationFrame(tick);
      });
    }

    stopMotion() {
      if (this._motionFrame) cancelAnimationFrame(this._motionFrame);
      this._motionFrame = null;
      if (this._motionReject) {
        const reject = this._motionReject;
        this._motionReject = null;
        reject(new DOMException("Pet motion cancelled", "AbortError"));
      }
      return this;
    }

    setSize(width, height = null) {
      this.config.width = numberOr(width, this.config.width);
      this.config.height = height == null ? null : numberOr(height, this._resolvedHeight());
      this.host.style.width = `${this.config.width}px`;
      this.host.style.height = `${this._resolvedHeight()}px`;
      this._handleViewportResize();
      this._emit("resize", this.snapshot());
      return this;
    }

    setSpriteSheet(spriteSheet, input = {}) {
      this.config.spriteSheet = spriteSheet;
      for (const key of ["columns", "rows", "cellWidth", "cellHeight", "imageRendering"]) {
        if (input[key] != null) this.config[key] = input[key];
      }
      if (input.states) {
        this.config.states = normalizeStates(input.states);
        if (!this.config.states[this._state]) {
          this._state = Object.keys(this.config.states)[0];
          this._frameIndex = 0;
        }
      }
      this._applySpriteStyles();
      this._restartTimer();
      this._emit("spritesheetchange", this.snapshot());
      return this;
    }

    show() {
      this._visible = true;
      this.host.hidden = false;
      this._emit("show", this.snapshot());
      return this;
    }

    hide() {
      this._visible = false;
      this.host.hidden = true;
      this._emit("hide", this.snapshot());
      return this;
    }

    snapshot() {
      return {
        id: this.id,
        state: this._state,
        paused: this._paused,
        visible: this._visible,
        position: { ...this._position },
        size: {
          width: this.host?.offsetWidth || this.config.width,
          height: this.host?.offsetHeight || this._resolvedHeight(),
        },
      };
    }

    destroy() {
      if (this._destroyed) return;
      this._destroyed = true;
      if (this._timer) window.clearTimeout(this._timer);
      this.stopMotion();
      window.removeEventListener("resize", this._boundResize);
      document.removeEventListener("pointermove", this._boundCursor);
      this.host.remove();
      this._emit("destroy", { id: this.id });
    }
  }

  const WebPet = Object.freeze({
    version: VERSION,
    defaultStates: DEFAULT_STATES,
    create(options) {
      return new Pet(options);
    },
  });

  global.WebPet = WebPet;
})(window);
