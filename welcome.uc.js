// ==UserScript==
// @name           BetterZenGradientPicker Welcome
// @version        2.1
// @description    Welcome page for BetterZenGradientPicker
// @author         JustAdumbPrsn
// @include        main
// ==/UserScript==

(function () {
  "use strict";

  if (window.gZenPickerWelcome) {
    return;
  }

  // Only readable while the script is being loaded.
  const kScriptURL = Components.stack.filename;

  // Set it back to false in about:config to see the welcome page again.
  const kSeenPref = "zen.better-gradient-picker.welcome-screen.seen";
  // Zen turns this off after its welcome; forced on while ours runs.
  const kAboutWelcomePref = "browser.aboutwelcome.enabled";
  const kStageAttribute = "zen-welcome-stage";

  const kVideoURL =
    "chrome://browser/content/zen-videos/welcome-background.mp4";
  const kRepositoryURL =
    "https://github.com/JustAdumbPrsn/BetterZenGradientPicker";
  const kTitleLines = ["Better Zen", "Gradient Picker"];
  const kZenElementsToIgnore = [
    "zen-browser-background",
    "zen-toast-container",
  ];

  const kSpring = { type: "spring", bounce: 0.35, visualDuration: 0.35 };
  const kExit = { duration: 0.12, ease: "easeIn" };
  const kFade = { duration: 0.25, ease: "easeOut" };

  const kNextButton = { label: "Next", primary: true };

  let gPages = null;
  let gClosing = false;
  let gShowing = false;
  let gColorsObserver = null;
  let gStyle = null;
  let gPrevAboutWelcome = null;
  let gVideoVisible = true;
  let gVideoAnimation = null;

  const gHiddenElements = new Set();

  function getMotion() {
    return window.gZenUIManager?.motion;
  }

  // Falls back to the end state when Zen's motion library is missing.
  function animate(target, keyframes, options) {
    const motion = getMotion();
    if (motion?.animate) {
      return motion.animate(target, keyframes, options);
    }
    const elements =
      typeof target === "string"
        ? document.querySelectorAll(target)
        : target instanceof Element
          ? [target]
          : target;
    const { opacity } = keyframes;
    if (opacity !== undefined) {
      for (const element of elements) {
        element.style.opacity = Array.isArray(opacity)
          ? opacity.at(-1)
          : opacity;
      }
    }
    return Promise.resolve();
  }

  function stagger(...args) {
    return getMotion()?.stagger?.(...args) ?? 0;
  }

  // Like Zen's motion animate(0, 1), but hands every frame to onUpdate.
  function animateProgress(onUpdate, options) {
    const motion = getMotion();
    if (!motion?.animate) {
      onUpdate(1);
      return { promise: Promise.resolve(), stop() {} };
    }
    let controls = null;
    const promise = new Promise(resolve => {
      controls = motion.animate(0, 1, {
        ...options,
        onUpdate,
        onComplete: resolve,
      });
      controls?.then?.(resolve, resolve);
    });
    return { promise, stop: () => controls?.stop?.() };
  }

  function parseXUL(xul) {
    return window.MozXULElement.parseXULToFragment(xul);
  }

  function makeEl(className, ...children) {
    const element = document.createElement("div");
    element.className = className;
    element.append(...children);
    return element;
  }

  function makeSvg(tag, attributes = {}, ...children) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attributes)) {
      element.setAttribute(name, value);
    }
    element.append(...children);
    return element;
  }

  function isMac() {
    return window.AppConstants?.platform === "macosx";
  }

  function forceAboutWelcomeOn() {
    if (gPrevAboutWelcome !== null) {
      return;
    }
    try {
      gPrevAboutWelcome = Services.prefs.getBoolPref(kAboutWelcomePref, false);
      Services.prefs.setBoolPref(kAboutWelcomePref, true);
      window.addEventListener("unload", restoreAboutWelcome, { once: true });
    } catch (ex) {
      console.error(`Failed to set ${kAboutWelcomePref}`, ex);
    }
  }

  function restoreAboutWelcome() {
    if (gPrevAboutWelcome === null) {
      return;
    }
    try {
      Services.prefs.setBoolPref(kAboutWelcomePref, gPrevAboutWelcome);
    } catch (ex) {
      console.error(`Failed to restore ${kAboutWelcomePref}`, ex);
    }
    gPrevAboutWelcome = null;
  }

  async function loadStylesheet() {
    const url = kScriptURL
      .split(" -> ")
      .pop()
      .split("?")[0]
      .replace(/[^/]*$/, "welcome.css");
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(response.statusText);
      }
      gStyle = document.createElement("style");
      gStyle.textContent = await response.text();
      document.documentElement.appendChild(gStyle);
      return true;
    } catch (ex) {
      console.error(`Failed to load ${url}`, ex);
      return false;
    }
  }

  function clearBrowserElements() {
    for (const element of document.getElementById("browser").children) {
      if (!kZenElementsToIgnore.includes(element.id)) {
        gHiddenElements.add(element);
        element.style.display = "none";
      }
    }
  }

  // Hidden workspace buttons get measured as 0px and shrunk to dots, so
  // measure again once visible.
  function fixWorkspaceIcons() {
    const run = () => {
      document.getElementById("browser")?.getBoundingClientRect();
      window.gZenWorkspaces?.onWindowResize?.();
    };
    run();
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  }

  async function restoreBrowserElements() {
    const elements = [...gHiddenElements];
    gHiddenElements.clear();
    for (const element of elements) {
      element.style.opacity = 0;
      element.style.removeProperty("display");
    }
    window.gZenUIManager?.updateTabsToolbar?.();
    fixWorkspaceIcons();
    await animate(elements, { opacity: [0, 1] });
  }

  function initializeWelcome() {
    const XUL = `
      <html:div id="bgp-welcome-root" role="dialog" aria-modal="true">
        <html:video id="bgp-welcome-video" autoplay="" loop="" muted=""
                    disablepictureinpicture="" tabindex="-1"
                    src="${kVideoURL}"></html:video>
        <html:div id="bgp-welcome">
          <html:div id="bgp-welcome-start">
            <html:h1 id="bgp-welcome-title"></html:h1>
            <button class="footer-button primary" id="bgp-welcome-start-button">
            </button>
          </html:div>
          <html:div id="bgp-welcome-pages">
            <html:div id="bgp-welcome-page-sidebar">
              <html:button id="bgp-welcome-back">Back</html:button>
              <html:div id="bgp-welcome-page-sidebar-content"></html:div>
              <html:div id="bgp-welcome-page-sidebar-buttons"></html:div>
            </html:div>
            <html:div id="bgp-welcome-page-content"></html:div>
          </html:div>
        </html:div>
      </html:div>
    `;
    document.getElementById("browser").appendChild(parseXUL(XUL));
    document
      .getElementById("bgp-welcome-video")
      .play()
      .catch(() => {});
  }

  function setVideoVisible(visible) {
    const video = document.getElementById("bgp-welcome-video");
    if (!video || gVideoVisible === visible) {
      return;
    }
    gVideoVisible = visible;
    gVideoAnimation?.stop?.();
    if (visible) {
      video.play().catch(() => {});
    }
    const current = Number(getComputedStyle(video).opacity);
    const run = animate(
      video,
      { opacity: [Number.isNaN(current) ? 0 : current, visible ? 1 : 0] },
      { duration: 0.6, ease: "easeOut" }
    );
    gVideoAnimation = run;
    const settle = () => {
      if (gVideoAnimation !== run || gVideoVisible !== visible) {
        return;
      }
      video.style.opacity = visible ? "1" : "0";
      if (!visible) {
        video.pause();
      }
    };
    run.then(settle, settle);
  }

  async function closeWelcome() {
    if (gClosing) {
      return;
    }
    gClosing = true;
    Services.prefs.setBoolPref(kSeenPref, true);
    restoreAboutWelcome();
    window.removeEventListener("keydown", onKeyDown, true);
    await animate("#bgp-welcome-root", { opacity: [1, 0] });
    document.getElementById("bgp-welcome-video")?.pause();
    gVideoAnimation?.stop?.();
    gVideoAnimation = null;
    gVideoVisible = true;
    document.getElementById("bgp-welcome-root").remove();
    gPages = null;
    gStyle?.remove();
    gStyle = null;
    await restoreBrowserElements();
    gClosing = false;
    gShowing = false;
  }

  // Escape skips the welcome page, so a broken page can never trap the user.
  function onKeyDown(event) {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (gPages) {
      gPages.finish();
    } else {
      closeWelcome();
    }
  }

  function openRepository() {
    try {
      const open = window.openTrustedLinkIn ?? window.openWebLinkIn;
      open(kRepositoryURL, "tab");
    } catch (ex) {
      console.error(`Failed to open ${kRepositoryURL}`, ex);
    }
  }

  function createGitHubIcon() {
    return makeSvg(
      "svg",
      {
        viewBox: "0 0 16 16",
        fill: "currentColor",
        class: "bgp-welcome-button-icon",
      },
      makeSvg("path", {
        d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z",
      })
    );
  }

  class nsZenPickerWelcomePages {
    #index = -1;
    #pages;

    constructor(pages) {
      this.#pages = pages;
      this.init();
      this.next();
    }

    get textContainer() {
      return document.getElementById("bgp-welcome-page-sidebar-content");
    }

    get contentContainer() {
      return document.getElementById("bgp-welcome-page-content");
    }

    get buttonsContainer() {
      return document.getElementById("bgp-welcome-page-sidebar-buttons");
    }

    get backButton() {
      return document.getElementById("bgp-welcome-back");
    }

    get currentPage() {
      return this.#pages[this.#index];
    }

    init() {
      document.getElementById("bgp-welcome-start").remove();
      const pages = document.getElementById("bgp-welcome-pages");
      pages.style.display = "flex";
      animate(pages, { opacity: [0, 1] }, { ...kFade, duration: 0.45 });
      this.backButton.addEventListener("click", () => this.back());
    }

    next() {
      this.#show(this.#index + 1, 1);
    }

    back() {
      if (this.#index > 0) {
        this.#show(this.#index - 1, -1);
      }
    }

    #show(index, direction) {
      const previous = this.currentPage;
      while (this.#pages[index]?.skip?.()) {
        index += direction;
      }
      if (index < 0) {
        return;
      }
      const page = this.#pages[index];
      if (!page) {
        // The index stays on the last page so finish() can run its leave().
        this.finish();
        return;
      }
      this.#index = index;
      document
        .getElementById("bgp-welcome-root")
        ?.toggleAttribute("force-light", !!page.forceLight);
      setVideoVisible(!page.gradientBackground);
      previous?.leave?.();
      this.#exit(this.textContainer, { x: [0, -80 * direction] });
      this.#exit(this.contentContainer, {});
      this.backButton.toggleAttribute("disabled", index === 0);
      this.#renderButtons(page);
      this.#renderText(page, direction);
      this.#renderContent(page);
    }

    #exit(container, keyframes) {
      for (const element of container.children) {
        if (element.hasAttribute("exiting")) {
          continue;
        }
        element.setAttribute("exiting", "");
        animate(element, { opacity: [1, 0], ...keyframes }, kExit).then(() =>
          element.remove()
        );
      }
    }

    #renderText(page, direction) {
      const text = makeEl("bgp-welcome-text");
      const title = document.createElement("h1");
      title.textContent = page.title;
      text.append(title);
      for (const description of page.descriptions ?? []) {
        const paragraph = document.createElement("p");
        paragraph.textContent = description;
        text.append(paragraph);
      }
      this.textContainer.append(text);
      animate(
        [...text.children],
        { opacity: [0, 1], x: [120 * direction, 0] },
        { ...kSpring, bounce: 0.4, visualDuration: 0.3, delay: stagger(0.03) }
      );
    }

    #renderContent(page) {
      const content = makeEl("bgp-welcome-page");
      if (page.id) {
        content.setAttribute("page", page.id);
      }
      page.render?.(content);
      this.contentContainer.append(content);
      animate(content, { opacity: [0, 1] }, kFade);
    }

    #renderButtons(page) {
      const fragment = document.createDocumentFragment();
      for (const button of page.buttons ?? [kNextButton]) {
        const element = document.createElement("button");
        element.className = button.primary
          ? "zen-big-accent-button primary"
          : "zen-big-accent-button";
        if (button.icon === "github") {
          element.append(createGitHubIcon(), button.label);
          element.classList.add("bgp-welcome-icon-button");
        } else {
          element.textContent = button.label;
        }
        element.addEventListener("click", () => {
          if (button.onclick?.(this) !== false) {
            this.next();
          }
        });
        fragment.append(element);
      }
      this.buttonsContainer.replaceChildren(fragment);
    }

    async finish() {
      this.currentPage?.leave?.();
      this.buttonsContainer.replaceChildren();
      this.backButton.toggleAttribute("disabled", true);
      await closeWelcome();
    }
  }

  const kPickerWidth = 380;
  const kPickerHeight = 600;
  const kPickerPadding = 10;
  const kPadHeight = 358;
  const kPadCenterX = (kPickerWidth - kPickerPadding * 2) / 2;
  const kPadCenterY = kPadHeight / 2;
  const kEdgeMargin = 28;
  const kScaleFactor = 0.88;
  const kListGap = 10;
  const kListCount = 8;

  // Stroke icons (24x24), used when the real button's icon can't be read.
  const kIcons = {
    palette: {
      sw: 2.2,
      paths: [
        "M2 12C2 17.5228 6.47715 22 12 22C13.6569 22 15 20.6569 15 19V18.5C15 18.0356 15 17.8034 15.0257 17.6084C15.2029 16.2622 16.2622 15.2029 17.6084 15.0257C17.8034 15 18.0356 15 18.5 15H19C20.6569 15 22 13.6569 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12Z",
        "M7 13C7.55228 13 8 12.5523 8 12C8 11.4477 7.55228 11 7 11C6.44772 11 6 11.4477 6 12C6 12.5523 6.44772 13 7 13Z",
        "M16 9C16.5523 9 17 8.55228 17 8C17 7.44772 16.5523 7 16 7C15.4477 7 15 7.44772 15 8C15 8.55228 15.4477 9 16 9Z",
        "M10 8C10.5523 8 11 7.55228 11 7C11 6.44772 10.5523 6 10 6C9.44772 6 9 6.44772 9 7C9 7.55228 9.44772 8 10 8Z",
      ],
    },
    wand: {
      sw: 2,
      paths: [
        "M13.0001 14L10.0001 11M15.0104 3.5V2M18.9498 5.06066L20.0104 4M18.9498 13L20.0104 14.0607M11.0104 5.06066L9.94979 4M20.5104 9H22.0104M6.13146 20.8686L15.3687 11.6314C15.7647 11.2354 15.9627 11.0373 16.0369 10.809C16.1022 10.6082 16.1022 10.3918 16.0369 10.191C15.9627 9.96265 15.7647 9.76465 15.3687 9.36863L14.6315 8.63137C14.2354 8.23535 14.0374 8.03735 13.8091 7.96316C13.6083 7.8979 13.3919 7.8979 13.1911 7.96316C12.9627 8.03735 12.7647 8.23535 12.3687 8.63137L3.13146 17.8686C2.73545 18.2646 2.53744 18.4627 2.46325 18.691C2.39799 18.8918 2.39799 19.1082 2.46325 19.309C2.53744 19.5373 2.73545 19.7354 3.13146 20.1314L3.86872 20.8686C4.26474 21.2646 4.46275 21.4627 4.69108 21.5368C4.89192 21.6021 5.10827 21.6021 5.30911 21.5368C5.53744 21.4627 5.73545 21.2646 6.13146 20.8686Z",
      ],
    },
    heart: {
      sw: 2.2,
      paths: [
        "M11.9932 5.13581C9.9938 2.7984 6.65975 2.16964 4.15469 4.31001C1.64964 6.45038 1.29697 10.029 3.2642 12.5604C4.89982 14.6651 9.84977 19.1041 11.4721 20.5408C11.6536 20.7016 11.7444 20.7819 11.8502 20.8135C11.9426 20.8411 12.0437 20.8411 12.1361 20.8135C12.2419 20.7819 12.3327 20.7016 12.5142 20.5408C14.1365 19.1041 19.0865 14.6651 20.7221 12.5604C22.6893 10.029 22.3797 6.42787 19.8316 4.31001C17.2835 2.19216 13.9925 2.7984 11.9932 5.13581Z",
      ],
    },
    add: {
      sw: 2.2,
      paths: [
        "M12 5v14M5 12h14",
      ],
    },
    remove: {
      sw: 2.2,
      paths: [
        "M5 12h14",
      ],
    },
    "toggle-algo": {
      sw: 2.2,
      paths: [
        "M12 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
        "M6 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
        "M18 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z",
        "M10.8 9.2L7.2 14.8M13.2 9.2l3.6 5.6M8.5 17h7",
      ],
    },
    "scheme-auto": {
      sw: 2.2,
      paths: [
        "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z",
        "M12 3v18",
      ],
    },
    "scheme-light": {
      sw: 2.2,
      paths: [
        "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z",
        "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
      ],
    },
    "scheme-dark": {
      sw: 2.2,
      paths: [
        "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
      ],
    },
  };

  // The real picker panel lives in this window, so the mockup reads icons,
  // margins and offsets from it. The values here are only a fallback.
  const kRealIds = {
    add: "PanelUI-zen-gradient-generator-color-add",
    remove: "PanelUI-zen-gradient-generator-color-remove",
    "toggle-algo": "PanelUI-zen-gradient-generator-color-toggle-algo",
    "scheme-auto": "PanelUI-zen-gradient-generator-scheme-auto",
    "scheme-light": "PanelUI-zen-gradient-generator-scheme-light",
    "scheme-dark": "PanelUI-zen-gradient-generator-scheme-dark",
    "chevron-left": "PanelUI-zen-gradient-generator-color-page-left",
    "chevron-right": "PanelUI-zen-gradient-generator-color-page-right",
    palette: "zen-picker-palette-cycle",
    wand: "zen-picker-randomize",
    heart: "zen-picker-favorite-save",
    actions: "PanelUI-zen-gradient-generator-color-actions",
    scheme: "PanelUI-zen-gradient-generator-scheme",
  };

  const kMarginProperties = [
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
  ];

  const kBottomButtons = [
    ["add", true],
    ["remove", true],
    ["toggle-algo", true],
    ["palette", false],
    ["heart", false],
  ];
  const kSchemeButtons = ["scheme-auto", "scheme-light", "scheme-dark"];

  const kDotAngles = [0, 30, 60, 300, 330];
  const kFloatingStartAngles = [0, 30, 330];
  const kDotBaseAngle = 315;
  const kDotStartAngle = 100;
  const kDotDistance = 118;
  const kDotSaturation = 0.88;
  const kDotDelay = 700;
  const kDotSpring = { duration: 0.4, type: "spring", bounce: 0.3 };
  const kColorRadius = (kPickerWidth - kPickerPadding * 2 + 30) / 2;

  const kColorLayouts = [
    [0],
    [0, 180],
    [0, 150, 210],
    [0, 90, 180, 270],
    [0, 72, 144, 216, 288],
    [0, 60, 120, 180, 240, 300],
  ];
  const kColorsStartDelay = 450;
  const kColorsAddHover = 110;
  const kColorsHold = 180;
  const kColorsSpring = { duration: 0.32, type: "spring", bounce: 0.28 };

  const kFloatingDrags = [
    [1, 82, 140, 0.3],
    [2, 196, 274, -0.3],
    [0, 268, 170, 0.3],
  ];
  const kFloatPause = 550;
  const kFloatHover = 220;
  const kFloatAfterShake = 700;
  const kFloatDragGap = 100;
  const kFloatDragTiming = { duration: 0.5, type: "spring", bounce: 0.2 };
  const kShakeRotations = [0, 8, -6, 3, -1.5, 0];
  const kShakeDuration = 600;

  const kHeartHoverDelay = 100;
  const kHeartClickDelay = 450;
  const kHeartUnhoverDelay = 500;
  const kListShiftDelay = 180;
  const kListReorderDelay = 200;
  const kListReorderTo = 4;
  const kListReorderTiming = { duration: 0.6, ease: [0.32, 0.72, 0, 1] };
  const kListShiftTiming = {
    duration: 450,
    easing: "cubic-bezier(0.34, 1.3, 0.64, 1)",
    fill: "forwards",
  };
  const kListNewTiming = {
    duration: 400,
    easing: "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
    fill: "backwards",
  };

  const kHeartDuration = 550;
  const kHeartEasePress = "cubic-bezier(0.416, 0.44, 0.667, 1)";
  const kHeartEase = "cubic-bezier(0.333, 0, 0.667, 1)";
  const kHeartShrink = [
    { offset: 0, scale: 1, easing: kHeartEasePress },
    { offset: 0.3134, scale: 0.625 },
    { offset: 1, scale: 0.625 },
  ];
  const kHeartPop = [
    { offset: 0, scale: 1, easing: kHeartEasePress },
    { offset: 0.3134, scale: 0.625, easing: kHeartEase },
    { offset: 0.5455, scale: 1.175, easing: kHeartEase },
    { offset: 1, scale: 1 },
  ];
  const kHeartLike = {
    outline: [
      kHeartShrink,
      [
        { offset: 0, opacity: 1, easing: "step-end" },
        { offset: 0.303, opacity: 0 },
        { offset: 1, opacity: 0 },
      ],
    ],
    filled: [
      kHeartPop,
      [
        { offset: 0, opacity: 0 },
        { offset: 0.1515, opacity: 0, easing: kHeartEase },
        { offset: 0.2727, opacity: 1 },
        { offset: 1, opacity: 1 },
      ],
    ],
  };

  const kFiveDotLayout = [
    [0, 0, "10%", "75%"],
    [95, 0, "0%", "62.5%"],
    [100, 72, "0%", "60%"],
    [50, 100, "0%", "60%"],
    [0, 72, "0%", "55%"],
  ];

  const clamp = value => Math.min(Math.max(value, 0), 1);
  const lerp = (from, to, progress) => from + (to - from) * progress;
  const curve = (from, control, to, t) =>
    (1 - t) ** 2 * from + 2 * (1 - t) * t * control + t ** 2 * to;
  // Rises to 1 over the first `edge` of progress and falls back over the last.
  const pulse = (progress, edge) =>
    clamp(Math.min(progress / edge, (1 - progress) / edge));
  const pxOnly = value => (/^-?[\d.]+px$/.test(value) ? value : "");

  // Timers and animations of one mockup, cleaned up together when it is left.
  function createScope() {
    const timers = new Set();
    const animations = [];
    const scope = {
      alive: true,
      wait(ms) {
        return new Promise(resolve => {
          const id = setTimeout(() => {
            timers.delete(id);
            resolve();
          }, ms);
          timers.add(id);
        });
      },
      later(ms, callback) {
        scope.wait(ms).then(() => {
          if (scope.alive) {
            callback();
          }
        });
      },
      track(animation) {
        animations.push(animation);
        return animation;
      },
      dispose() {
        scope.alive = false;
        timers.forEach(clearTimeout);
        for (const animation of animations) {
          if (animation.stop) {
            animation.stop();
          } else {
            animation.cancel?.();
          }
        }
      },
    };
    return scope;
  }

  async function runSteps(scope, start, steps, { ease, hold }, update) {
    let current = start;
    for (const { to, duration } of steps) {
      const from = current;
      const run = animateProgress(
        progress => {
          current = lerp(from, to, progress);
          update(current);
        },
        { duration, ease }
      );
      await scope.track(run).promise;
      if (!scope.alive) {
        return;
      }
      current = to;
      update(current);
      await scope.wait(hold);
      if (!scope.alive) {
        return;
      }
    }
  }

  function getReal(name) {
    const id = kRealIds[name];
    return id ? document.getElementById(id) : null;
  }

  function getRealIconURL(real) {
    const imageOf = element => {
      const image = element && getComputedStyle(element).listStyleImage;
      return image && image !== "none" ? image : null;
    };
    const icon = real.querySelector(
      ".button-icon, .toolbarbutton-icon, image, img"
    );
    const attr = real.getAttribute("image") || icon?.getAttribute("src");
    return imageOf(real) || (attr && `url("${attr}")`) || imageOf(icon);
  }

  function copyLayout(real, mock, properties) {
    const style = getComputedStyle(real);
    for (const property of properties) {
      const value = pxOnly(style[property]);
      if (value) {
        mock.style[property] = value;
      }
    }
  }

  function createIcon(name) {
    const { sw, paths } = kIcons[name];
    return makeSvg(
      "svg",
      {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": sw,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      },
      ...paths.map(d => makeSvg("path", { d }))
    );
  }

  function createRealIcon(url, size) {
    const icon = makeEl("bgp-mock-icon");
    icon.style.backgroundImage = url;
    icon.style.width = icon.style.height = size;
    return icon;
  }

  function createHeartIcon() {
    return makeSvg(
      "svg",
      { viewBox: "0 0 24 24", class: "bgp-mock-heart" },
      ...["outline", "filled"].map(layer =>
        makeSvg("path", {
          class: `bgp-mock-heart-${layer}`,
          d: kIcons.heart.paths[0],
        })
      )
    );
  }

  function playHeartLike(button) {
    button.classList.add("is-favorite");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return [];
    }
    return Object.entries(kHeartLike).flatMap(([layer, tracks]) => {
      const path = button.querySelector(`.bgp-mock-heart-${layer}`);
      return tracks.map(keyframes =>
        path.animate(keyframes, { duration: kHeartDuration })
      );
    });
  }

  function pressButton(scope, button) {
    if (button) {
      scope.track(
        button.animate([{ scale: 1 }, { scale: 0.82 }, { scale: 1 }], {
          duration: 180,
          easing: "ease-out",
        })
      );
    }
  }

  function createPadButton(name, native) {
    const button = makeEl("bgp-mock-action");
    button.setAttribute("action", name);
    button.toggleAttribute("native", native);
    const real = getReal(name);
    if (real) {
      copyLayout(real, button, kMarginProperties);
    }
    const radius = pxOnly(
      getComputedStyle(getReal("add") ?? real ?? document.documentElement)
        .borderTopLeftRadius
    );
    if (radius) {
      button.style.setProperty("--bgp-mock-action-radius", radius);
    }
    const url = native && real ? getRealIconURL(real) : null;
    if (name === "heart") {
      button.append(createHeartIcon());
    } else if (url) {
      const realIcon = real.querySelector(".button-icon, .toolbarbutton-icon");
      const size = pxOnly(realIcon ? getComputedStyle(realIcon).width : "");
      button.append(createRealIcon(url, size || "16px"));
    } else {
      button.append(createIcon(name));
    }
    return button;
  }

  function createChevron(side) {
    const chevron = makeEl(`bgp-mock-chevron ${side}`);
    const real = getReal(`chevron-${side}`);
    if (real) {
      copyLayout(real, chevron, kMarginProperties);
      const url = getRealIconURL(real);
      if (url) {
        chevron.classList.add("real");
        chevron.append(createRealIcon(url, "16px"));
      }
    }
    return chevron;
  }

  function createList() {
    return makeEl(
      "bgp-mock-list",
      createChevron("left"),
      ...Array.from({ length: kListCount }, () => makeEl("bgp-mock-list-dot")),
      createChevron("right")
    );
  }

  function getDotColor(x, y) {
    const dx = x - kPadCenterX;
    const dy = y - kPadCenterY;
    const ratio = Math.min(Math.hypot(dx, dy) / kColorRadius, 1);
    const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 360;
    const saturation = (90 + ratio * 10) * kDotSaturation;
    return `hsl(${Math.round(hue) % 360} ${Math.round(saturation)}% ${Math.round(ratio * 100)}%)`;
  }

  function placeDot(dot, x, y) {
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.setProperty("--bgp-mock-dot-color", getDotColor(x, y));
  }

  function getDotPosition(dot) {
    return { x: parseFloat(dot.style.left), y: parseFloat(dot.style.top) };
  }

  function createDot(primary) {
    const dot = makeEl("bgp-mock-dot");
    dot.toggleAttribute("primary", primary);
    return dot;
  }

  function getRingPositions(baseAngle, offsets) {
    return offsets.map(offset => {
      const radian = (((baseAngle + offset) % 360) * Math.PI) / 180;
      return {
        x: kPadCenterX + kDotDistance * Math.cos(radian),
        y: kPadCenterY + kDotDistance * Math.sin(radian),
      };
    });
  }

  function buildSavedGradient(colors) {
    return kFiveDotLayout
      .map(
        ([x, y, inner, outer], i) =>
          `radial-gradient(circle at ${x}% ${y}%, ${colors[i]} ${inner}, transparent ${outer})`
      )
      .reverse()
      .join(", ");
  }

  function watchFit(stage, picker, getLayout) {
    const fit = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) {
        return;
      }
      const { scale, x, y } = getLayout(width, height);
      picker.style.translate = `${x}px ${y}px`;
      picker.style.scale = scale;
      picker.style.setProperty("--bgp-mock-scale", scale);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    fit();
    return () => observer.disconnect();
  }

  function getPickerScale(width, height) {
    const padCenterY = kPickerPadding + kPadHeight / 2;
    const byWidth = (width / 2 - kEdgeMargin) / (kPickerWidth / 2);
    const byHeight = (height / 2 - kEdgeMargin) / padCenterY;
    return Math.max(Math.min(byWidth, byHeight) * kScaleFactor, 0.1);
  }

  // mode: "save", "colors" or "floating".
  function createPickerMock(stage, mode = "save") {
    const scope = createScope();
    const picker = makeEl("bgp-mock-picker");
    picker.style.setProperty("--bgp-mock-picker-width", `${kPickerWidth}px`);
    picker.style.setProperty("--bgp-mock-picker-height", `${kPickerHeight}px`);
    const pad = makeEl("bgp-mock-pad");
    picker.append(pad);

    const dotSize = pxOnly(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--icon-size-medium")
        .trim()
    );
    pad.style.setProperty("--bgp-mock-dot-size", dotSize || "20px");

    const angles = mode === "floating" ? kFloatingStartAngles : kDotAngles;
    const targets = getRingPositions(kDotBaseAngle, angles);
    const starts = getRingPositions(kDotStartAngle, angles);
    const dots =
      mode === "colors"
        ? []
        : targets.map((target, index) => {
            const dot = createDot(index === 0);
            pad.append(dot);
            return dot;
          });
    const placeDotsAt = progress =>
      dots.forEach((dot, index) =>
        placeDot(
          dot,
          lerp(starts[index].x, targets[index].x, progress),
          lerp(starts[index].y, targets[index].y, progress)
        )
      );
    placeDotsAt(0);

    const actions = makeEl(
      "bgp-mock-actions",
      ...kBottomButtons.map(([name, native]) => createPadButton(name, native))
    );
    const scheme = makeEl(
      "bgp-mock-scheme",
      ...kSchemeButtons.map(name => createPadButton(name, true))
    );
    const wand = createPadButton("wand", false);
    pad.append(scheme, actions, wand);

    for (const [mock, name, properties] of [
      [actions, "actions", ["columnGap", "bottom"]],
      [scheme, "scheme", ["columnGap", "top"]],
      [wand, "wand", ["top", "left"]],
    ]) {
      const real = getReal(name);
      if (real) {
        copyLayout(real, mock, properties);
        if (mock.style.columnGap) {
          mock.style.gap = mock.style.columnGap;
        }
      }
    }

    const list = createList();
    const listDots = [...list.querySelectorAll(".bgp-mock-list-dot")];
    list.style.marginTop = `${kListGap}px`;
    picker.append(list);
    stage.append(picker);

    const heart = actions.querySelector('[action="heart"]');

    const reorderList = dragged => {
      const items = [...list.querySelectorAll(".bgp-mock-list-dot")];
      const from = items.indexOf(dragged);
      const to = Math.min(kListReorderTo, items.length - 1);
      if (from < 0 || to <= from) {
        return;
      }
      const step = items[1].offsetLeft - items[0].offsetLeft;
      const passed = items.slice(from + 1, to + 1);
      dragged.style.zIndex = 5;
      const update = progress => {
        const held = pulse(progress, 0.2);
        dragged.style.translate = `${step * (to - from) * progress}px 0px`;
        dragged.style.scale = 1 + 0.25 * held;
        dragged.style.boxShadow = `0 0 1px 1px rgba(0, 0, 0, 0.1), 0 ${6 * held}px ${14 * held}px rgba(0, 0, 0, ${0.25 * held})`;
        passed.forEach((item, index) => {
          item.style.translate = `${-step * clamp((to - from) * progress - index)}px 0`;
        });
      };
      const run = scope.track(animateProgress(update, kListReorderTiming));
      run.promise.then(() => {
        if (!scope.alive) {
          return;
        }
        update(1);
        list.insertBefore(dragged, items[to + 1] ?? list.lastElementChild);
        for (const item of items) {
          item.style.translate = item.style.scale = "";
          item.style.boxShadow = item.style.zIndex = "";
        }
      });
    };

    const shiftList = () => {
      const step = listDots[1].offsetLeft - listDots[0].offsetLeft;
      const newDot = makeEl("bgp-mock-list-dot saved entering");
      newDot.style.left = `${listDots[0].offsetLeft}px`;
      newDot.style.top = `${listDots[0].offsetTop}px`;
      newDot.style.background = buildSavedGradient(
        targets.map(target => getDotColor(target.x, target.y))
      );
      list.append(newDot);
      const shifts = listDots.map((dot, index) =>
        dot.animate(
          [
            { transform: "translateX(0)", opacity: 1 },
            {
              transform: `translateX(${step}px)`,
              opacity: index === listDots.length - 1 ? 0 : 1,
            },
          ],
          kListShiftTiming
        )
      );
      const entrance = newDot.animate(
        [
          { transform: "scale(0.6)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        kListNewTiming
      );
      const animations = [entrance, ...shifts];
      animations.forEach(animation => scope.track(animation));
      Promise.all(shifts.map(animation => animation.finished))
        .then(() => {
          if (!scope.alive) {
            return;
          }
          listDots.pop().remove();
          animations.forEach(animation => animation.cancel());
          newDot.classList.remove("entering");
          newDot.style.left = newDot.style.top = "";
          list.insertBefore(newDot, listDots[0]);
          scope.later(kListReorderDelay, () => reorderList(newDot));
        })
        .catch(() => {});
    };

    const springDotsIn = async () => {
      await scope.track(animateProgress(placeDotsAt, kDotSpring)).promise;
      if (scope.alive) {
        placeDotsAt(1);
      }
      return scope.alive;
    };

    const playSave = async () => {
      if (!(await springDotsIn())) {
        return;
      }
      const click = kHeartHoverDelay + kHeartClickDelay;
      scope.later(kHeartHoverDelay, () => heart?.setAttribute("hovered", ""));
      scope.later(click, () => {
        if (heart) {
          playHeartLike(heart).forEach(animation => scope.track(animation));
        }
      });
      scope.later(click + kListShiftDelay, shiftList);
      scope.later(click + kHeartUnhoverDelay, () =>
        heart?.removeAttribute("hovered")
      );
    };

    const addColorDot = async count => {
      const addButton = actions.querySelector('[action="add"]');
      addButton?.setAttribute("hovered", "");
      await scope.wait(kColorsAddHover);
      if (!scope.alive) {
        return;
      }
      pressButton(scope, addButton);
      const to = getRingPositions(kDotBaseAngle, kColorLayouts[count - 1]);
      const from = to.map((target, index) => {
        if (dots[index]) {
          return getDotPosition(dots[index]);
        }
        return count === 1 ? target : { x: kPadCenterX, y: kPadCenterY };
      });
      const fresh = createDot(count === 1);
      fresh.style.scale = 0;
      fresh.style.opacity = 0;
      pad.append(fresh);
      dots.push(fresh);
      const place = progress => {
        dots.forEach((dot, index) =>
          placeDot(
            dot,
            lerp(from[index].x, to[index].x, progress),
            lerp(from[index].y, to[index].y, progress)
          )
        );
        fresh.style.scale = Math.max(progress, 0);
        fresh.style.opacity = clamp(progress * 4);
      };
      place(0);
      const run = scope.track(animateProgress(place, kColorsSpring));
      addButton?.removeAttribute("hovered");
      await run.promise;
      if (!scope.alive) {
        return;
      }
      place(1);
      fresh.style.scale = fresh.style.opacity = "";
    };

    const playColors = async () => {
      await scope.wait(kColorsStartDelay);
      for (let count = 1; count <= kColorLayouts.length; count++) {
        await addColorDot(count);
        await scope.wait(kColorsHold);
        if (!scope.alive) {
          return;
        }
      }
    };

    const shakeDot = dot => {
      const { x, y } = getDotPosition(dot);
      dot.style.transformOrigin = `calc(50% + ${kPadCenterX - x}px) calc(50% + ${kPadCenterY - y}px)`;
      const animation = dot.animate(
        kShakeRotations.map((rotation, index) => ({
          offset: index / (kShakeRotations.length - 1),
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        })),
        { duration: kShakeDuration }
      );
      scope.track(animation);
      animation.finished
        .then(() => {
          dot.style.transformOrigin = "";
        })
        .catch(() => {});
    };

    const dragDot = async (dot, to, bend) => {
      const from = getDotPosition(dot);
      const control = {
        x: (from.x + to.x) / 2 - (to.y - from.y) * bend,
        y: (from.y + to.y) / 2 + (to.x - from.x) * bend,
      };
      const zIndex = dot.style.zIndex;
      dot.style.zIndex = 1000;
      const run = scope.track(
        animateProgress(t => {
          placeDot(
            dot,
            curve(from.x, control.x, to.x, t),
            curve(from.y, control.y, to.y, t)
          );
          dot.style.scale = 1 + 0.2 * pulse(t, 0.15);
        }, kFloatDragTiming)
      );
      await run.promise;
      if (!scope.alive) {
        return;
      }
      placeDot(dot, to.x, to.y);
      dot.style.scale = "";
      dot.style.zIndex = zIndex;
    };

    const playFloating = async () => {
      if (!(await springDotsIn())) {
        return;
      }
      await scope.wait(kFloatPause);
      const toggle = actions.querySelector('[action="toggle-algo"]');
      toggle?.setAttribute("hovered", "");
      await scope.wait(kFloatHover);
      if (!scope.alive) {
        return;
      }
      pressButton(scope, toggle);
      dots.forEach(shakeDot);
      await scope.wait(kFloatAfterShake);
      toggle?.removeAttribute("hovered");
      for (const [index, x, y, bend] of kFloatingDrags) {
        if (!scope.alive) {
          return;
        }
        await dragDot(dots[index], { x, y }, bend);
        await scope.wait(kFloatDragGap);
      }
    };

    const padCenterY = kPickerPadding + kPadCenterY;
    const stopFit = watchFit(stage, picker, (width, height) => {
      const scale = getPickerScale(width, height);
      return {
        scale,
        x: width / 2 - (kPickerWidth / 2) * scale,
        y: height / 2 - padCenterY * scale,
      };
    });

    if (mode === "colors") {
      playColors();
    } else {
      scope.later(kDotDelay, mode === "floating" ? playFloating : playSave);
    }
    return () => {
      scope.dispose();
      stopFit();
    };
  }

  const kWaveSinePath =
    "M 51.373 27.395 C 60.14 -8.503 68.906 -8.503 77.671 27.395 C 86.438 63.293 95.205 63.293 103.971 27.395 C 112.738 -8.503 121.504 -8.503 130.271 27.395 C 139.037 63.293 147.803 63.293 156.57 27.395 C 165.335 -8.503 174.101 -8.503 182.868 27.395 C 191.634 63.293 200.4 63.293 209.167 27.395 C 217.933 -8.503 226.7 -8.503 235.467 27.395 C 244.233 63.293 252.999 63.293 261.765 27.395 C 270.531 -8.503 279.297 -8.503 288.064 27.395 C 296.83 63.293 305.596 63.293 314.363 27.395 C 323.13 -8.503 331.896 -8.503 340.662 27.395 M 314.438 27.395 C 323.204 -8.503 331.97 -8.503 340.737 27.395 C 349.503 63.293 358.27 63.293 367.037 27.395";
  const kWaveRefY = 27.395;
  const kCircumference = 314.159;
  const kGrainDots = 16;

  function getWavePath(amplitude) {
    let index = 0;
    return kWaveSinePath
      .split(" ")
      .map(token => {
        if (token == "M" || token == "C") {
          index = 0;
          return token;
        }
        const value = Number(token);
        return index++ % 2 ? lerp(kWaveRefY, value, amplitude) : value;
      })
      .join(" ");
  }

  function createWaveSlider(progress) {
    const gradientId = "bgp-mock-wave-lightness";
    const stop = (offset, color) => makeSvg("stop", { offset, class: color });
    const darkEnd = stop("0%", "dark");
    const trackStart = stop("0%", "track");
    const gradient = makeSvg(
      "linearGradient",
      { id: gradientId, x1: "0%", y1: "0%", x2: "100%", y2: "0%" },
      stop("0%", "dark"),
      darkEnd,
      trackStart
    );
    const path = makeSvg("path", {
      fill: "none",
      stroke: `url(#${gradientId})`,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    });
    const svg = makeSvg(
      "svg",
      { viewBox: "0 -7.605 455 70", preserveAspectRatio: "none" },
      makeSvg("defs", {}, gradient),
      path
    );
    const slider = makeEl(
      "bgp-mock-slider",
      makeEl("bgp-mock-wave", svg),
      makeEl("bgp-mock-thumb")
    );
    slider.setProgress = value => {
      darkEnd.setAttribute("offset", `${value * 100}%`);
      trackStart.setAttribute("offset", `${value * 100}%`);
      path.setAttribute("d", getWavePath(value));
      slider.style.setProperty("--bgp-mock-progress", value);
    };
    slider.setProgress(progress);
    return slider;
  }

  function createGrainKnob(value) {
    const knob = makeEl("bgp-mock-knob");
    for (let i = 0; i < kGrainDots; i++) {
      const angle = (i / kGrainDots) * 2 * Math.PI - Math.PI / 2;
      const dot = makeEl(
        i / kGrainDots <= value
          ? "bgp-mock-grain-dot active"
          : "bgp-mock-grain-dot"
      );
      dot.style.left = `${Math.cos(angle) * 50 + 50}%`;
      dot.style.top = `${Math.sin(angle) * 50 + 50}%`;
      knob.append(dot);
    }
    const angle = value * 2 * Math.PI - Math.PI / 2;
    const handle = makeEl("bgp-mock-handle");
    handle.style.left = `calc(${Math.cos(angle) * 50 + 50}% - 3px)`;
    handle.style.top = `calc(${Math.sin(angle) * 50 + 50}% - 6px)`;
    handle.style.transform = `rotate(${value * 360}deg)`;
    knob.append(handle);
    return knob;
  }

  function createRotationDial(degrees, withLabel = false) {
    const rem =
      parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
    const size = rem * (isMac() ? 6 : 5);
    const circle = () =>
      makeSvg("circle", { cx: 50, cy: 50, r: 50, "stroke-width": 400 / size });
    const box = { viewBox: "0 0 100 100" };
    const handleBox = makeEl(
      "bgp-mock-dial-handle-box",
      makeEl("bgp-mock-handle")
    );
    const arc = circle();
    const label = withLabel ? makeEl("bgp-mock-dial-label") : null;
    const dial = makeEl(
      "bgp-mock-knob",
      makeSvg("svg", { ...box, class: "bgp-mock-dial-ring" }, circle()),
      makeSvg("svg", { ...box, class: "bgp-mock-dial-arc" }, arc),
      handleBox
    );
    if (label) {
      dial.append(label);
    }
    dial.setAngle = value => {
      const wrapped = ((value % 360) + 360) % 360;
      if (label) {
        label.textContent = `${Math.round(wrapped)}°`;
      }
      handleBox.style.transform = `rotate(${value}deg)`;
      arc.setAttribute(
        "stroke-dasharray",
        `${(wrapped / 360) * kCircumference} ${kCircumference}`
      );
    };
    dial.setAngle(degrees);
    return dial;
  }

  function createBottomPicker(lightnessProgress, dialDegrees, options = {}) {
    const picker = makeEl("bgp-mock-picker");
    picker.setAttribute("bottom-edge", "");
    picker.style.setProperty("--bgp-mock-picker-width", `${kPickerWidth}px`);
    picker.style.setProperty("--bgp-mock-picker-height", "auto");

    const lightness = options.plainLightness
      ? makeEl("bgp-mock-bar")
      : createWaveSlider(lightnessProgress);
    const dial = createRotationDial(dialDegrees, !!options.dialLabel);
    const pad = makeEl("bgp-mock-pad");
    picker.append(
      pad,
      createList(),
      makeEl("bgp-mock-row", makeEl("bgp-mock-bar"), createGrainKnob(0.625)),
      makeEl("bgp-mock-row", lightness, dial)
    );
    return { picker, pad, lightness, dial };
  }

  const kLightnessStart = 0.2;
  const kLightnessSteps = [
    { to: 0.8, duration: 0.8 },
    { to: 0.4, duration: 0.7 },
    { to: 1, duration: 0.8 },
  ];
  const kLightnessTiming = { ease: [0.45, 0, 0.2, 1], hold: 200 };
  const kPreviewDelay = 350;
  const kPreviewToSliderDelay = 450;
  const kPreviewSpring = { type: "spring", bounce: 0.45, visualDuration: 0.5 };

  function createLightnessMock(stage) {
    const scope = createScope();
    const { picker, lightness } = createBottomPicker(kLightnessStart, 120);
    const preview = makeEl(
      "bgp-mock-preview",
      makeEl("bgp-mock-preview-drop"),
      makeEl("bgp-mock-preview-dot")
    );
    preview.style.opacity = 0;
    lightness.append(preview);
    stage.append(picker);

    const stopFit = watchFit(stage, picker, (width, height) => {
      const pickerWidth = picker.offsetWidth;
      const sliderCenterX = lightness.offsetLeft + lightness.offsetWidth / 2;
      const sliderCenterY = lightness.offsetTop + lightness.offsetHeight / 2;
      const scale = width / 2 / (pickerWidth - sliderCenterX);
      return {
        scale,
        x: width - pickerWidth * scale,
        y: height / 2 - sliderCenterY * scale,
      };
    });

    (async () => {
      await scope.wait(kPreviewDelay);
      if (!scope.alive) {
        return;
      }
      scope.track(
        animate(
          preview,
          { opacity: [0, 1], scale: [0.2, 1], y: [-14, 0] },
          { ...kPreviewSpring, opacity: { duration: 0.2 } }
        )
      );
      await scope.wait(kPreviewToSliderDelay);
      if (scope.alive) {
        await runSteps(
          scope,
          kLightnessStart,
          kLightnessSteps,
          kLightnessTiming,
          lightness.setProgress
        );
      }
    })();

    return () => {
      scope.dispose();
      stopFit();
    };
  }

  const kRotationMaxDialShare = 0.3;
  const kRotationStart = 30;
  const kRotationSteps = [
    { to: 210, duration: 0.8 },
    { to: 100, duration: 0.7 },
    { to: 620, duration: 1.2 },
  ];
  const kRotationTiming = { ease: [0.45, 0, 0.2, 1], hold: 180 };
  const kRotationStartDelay = 600;

  function createRotationMock(stage) {
    const scope = createScope();
    const { picker, pad, dial } = createBottomPicker(0.5, kRotationStart, {
      plainLightness: true,
      dialLabel: true,
    });
    picker.setAttribute("round-right", "");
    stage.append(picker);

    const fit = () => {
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) {
        return;
      }
      const padEnd = pad.offsetTop + pad.offsetHeight;
      const dialCenterY = dial.offsetTop + dial.offsetHeight / 2;
      const scale = Math.min(
        height / 2 / (dialCenterY - padEnd),
        (width * kRotationMaxDialShare) / dial.offsetWidth
      );
      picker.style.scale = scale;
      picker.style.setProperty("--bgp-mock-scale", scale);
      // Reset first so the measurements below don't include the old offset.
      picker.style.translate = "0px 0px";
      const stageRect = stage.getBoundingClientRect();
      const dialRect = dial.getBoundingClientRect();
      const dx = dialRect.left + dialRect.width / 2;
      const dy = dialRect.top + dialRect.height / 2;
      const x = stageRect.left + width / 2 - dx;
      const y = stageRect.top + height / 2 - dy;
      picker.style.translate = `${x}px ${y}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    observer.observe(picker);
    fit();

    scope
      .wait(kRotationStartDelay)
      .then(() =>
        runSteps(
          scope,
          kRotationStart,
          kRotationSteps,
          kRotationTiming,
          dial.setAngle
        )
      );

    return () => {
      scope.dispose();
      observer.disconnect();
    };
  }

  const kMoreButtons = [
    { icon: "wand", label: "Randomize" },
    { icon: "palette", label: "Palettes" },
    {
      iconURL: 'url("chrome://global/skin/icons/settings.svg")',
      label: "Preferences",
    },
    { icon: "toggle-algo", real: "toggle-algo", label: "Harmonies" },
  ];
  const kMoreScale = 0.9;

  function createMoreMock(stage) {
    const grid = makeEl("bgp-more-grid");
    for (const { icon, iconURL, real, label } of kMoreButtons) {
      const realButton = real && getReal(real);
      const url = iconURL ?? (realButton && getRealIconURL(realButton));
      const element = makeEl(
        "bgp-more-button",
        url ? createRealIcon(url, "30px") : createIcon(icon),
        label
      );
      element.style.opacity = 0;
      grid.append(element);
    }
    stage.append(grid);

    const page = stage.parentElement;
    const fit = () => {
      if (!page.clientWidth || !page.clientHeight) {
        return;
      }
      const scale = getPickerScale(page.clientWidth, page.clientHeight);
      grid.style.width = `${(kPickerWidth - kPickerPadding * 2) * scale * kMoreScale}px`;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(page);
    fit();

    const animation = animate([...grid.children], { opacity: [0, 1] }, kFade);
    return () => {
      observer.disconnect();
      animation?.stop?.();
    };
  }

  // mockup(stage) builds the demo and returns its cleanup function.
  const kFeatures = [
    {
      id: "feature-save",
      title: "Save your gradients",
      descriptions: [
        "Found a gradient you love? Save it with a single click.",
        "Your saved gradients live in the gradient list, ready whenever you want them back",
      ],
      fullbleed: true,
      mockup: createPickerMock,
    },
    {
      id: "feature-2",
      title: "Tune the lightness",
      descriptions: [
        "Want softer pastels or deeper darks? Drag the lightness slider.",
        "Your colors stay right where they are, only how light they look changes.",
      ],
      fullbleed: true,
      mockup: createLightnessMock,
    },
    {
      id: "feature-3",
      title: "Up to 6 colors",
      descriptions: [
        "Why stop at three? Add up to six colors to a gradient.",
        "Fine tune your gradient with more colors!",
      ],
      fullbleed: true,
      mockup: stage => createPickerMock(stage, "colors"),
    },
    {
      id: "feature-4",
      title: "Rotate!",
      descriptions: [
        "Turn the rotation dial to swing the whole gradient around.",
        "Same colors, a completely different feel, all in one twist.",
      ],
      fullbleed: true,
      mockup: createRotationMock,
    },
    {
      id: "feature-5",
      title: "Move colors freely",
      descriptions: [
        "Switch the harmony to floating and every color becomes yours to move.",
        "Drag the dots anywhere on the pad for a gradient that is truly your own.",
      ],
      fullbleed: true,
      mockup: stage => createPickerMock(stage, "floating"),
    },
    {
      id: "feature-6",
      title: "And much more",
      descriptions: [
        "There are a few more tricks waiting for you inside the picker.",
      ],
      mockup: createMoreMock,
    },
  ];

  function createFeaturePage({ id, title, descriptions, fullbleed, mockup }) {
    let cleanup = null;
    return {
      id,
      title,
      descriptions,
      forceLight: true,
      render(content) {
        const stage = makeEl("bgp-welcome-feature-stage");
        stage.setAttribute("feature", id);
        stage.toggleAttribute("fullbleed", !!fullbleed);
        content.append(stage);
        cleanup = mockup(stage);
      },
      leave() {
        cleanup?.();
        cleanup = null;
      },
    };
  }

  function createColorsPage() {
    return {
      id: "colors",
      title: "Try it out!",
      descriptions: [
        "Pick the colors that feel right for your workspace.",
        "You can reopen the gradient picker and change it any time.",
      ],
      gradientBackground: true,
      skip: () => !window.gZenThemePicker,
      render(content) {
        const anchor = document.createElement("div");
        anchor.id = "bgp-welcome-workspace-colors-anchor";
        content.append(anchor);
        const panel = window.gZenThemePicker.panel;
        panel.setAttribute("noautohide", "true");
        panel.setAttribute("consumeoutsideclicks", "false");
        panel.setAttribute("nonnative", "");
        let lastSize = "";
        const sizeAnchor = () => {
          const { width, height } = panel.getBoundingClientRect();
          // 20 is the shadow width * 2.
          anchor.style.height = `${height - (isMac() ? -90 : 20)}px`;
          anchor.style.width = `${width - 20}px`;
          lastSize = `${width}x${height}`;
        };
        panel.addEventListener("popupshowing", sizeAnchor, { once: true });
        // The picker grows after it opens, so keep the anchor in sync.
        gColorsObserver = new ResizeObserver(() => {
          const { width, height } = panel.getBoundingClientRect();
          if (lastSize === `${width}x${height}`) {
            return;
          }
          sizeAnchor();
          panel.moveToAnchor(anchor, "overlap");
        });
        panel.addEventListener(
          "popupshown",
          () => gColorsObserver?.observe(panel),
          { once: true }
        );
        PanelMultiView.openPopup(panel, anchor, { position: "overlap" });
      },
      leave() {
        gColorsObserver?.disconnect();
        gColorsObserver = null;
        const panel = window.gZenThemePicker.panel;
        panel.removeAttribute("noautohide");
        panel.removeAttribute("consumeoutsideclicks");
        panel.removeAttribute("nonnative");
        animate(panel, { opacity: [1, 0] }, kExit).then(() => {
          panel.hidePopup();
          panel.removeAttribute("style");
        });
      },
    };
  }

  // Buttons default to a single "Next" button.
  function getWelcomePages() {
    return [
      ...kFeatures.map(createFeaturePage),
      createColorsPage(),
      {
        id: "finish",
        title: "You're all set",
        descriptions: [
        "Thanks for installing the mod!",
        "If you like it, make sure to give the repository a star.",
      ],
        gradientBackground: true,
        buttons: [
          {
            label: "Star the repository",
            icon: "github",
            onclick: openRepository,
          },
          { label: "Sweet!", primary: true },
        ],
      },
    ];
  }

  async function animateInitialStage() {
    const title = document.getElementById("bgp-welcome-title");
    for (const line of kTitleLines) {
      const lineElement = document.createElement("span");
      for (const char of line) {
        if (char === " ") {
          lineElement.append(" ");
          continue;
        }
        const charElement = document.createElement("span");
        charElement.className = "bgp-welcome-char";
        charElement.textContent = char;
        lineElement.append(charElement);
      }
      title.append(lineElement);
    }
    await animate(
      title.querySelectorAll(".bgp-welcome-char"),
      { opacity: [0, 1], y: [50, 0] },
      {
        delay: stagger(0.035, { startDelay: 0.8 }),
        type: "spring",
        bounce: 0.3,
        visualDuration: 0.45,
      }
    );
    const button = document.getElementById("bgp-welcome-start-button");
    // The welcome page was skipped while the title was animating.
    if (!button) {
      return;
    }
    button.addEventListener(
      "click",
      async () => {
        await animate(
          "#bgp-welcome-title .bgp-welcome-char, #bgp-welcome-start-button",
          { opacity: [1, 0], y: [0, -14] },
          { duration: 0.3, ease: "easeIn", delay: stagger(0.012) }
        );
        gPages = new nsZenPickerWelcomePages(getWelcomePages());
      },
      { once: true }
    );
    await animate(
      button,
      { opacity: [0, 1], y: [20, 0], filter: ["blur(2px)", "blur(0px)"] },
      { delay: 0.1, type: "spring", stiffness: 300, damping: 20, mass: 1.8 }
    );
  }

  async function showWelcome() {
    if (gShowing) {
      return;
    }
    gShowing = true;
    // Without styles the UI would be hidden behind a broken page, so bail out.
    if (!(await loadStylesheet())) {
      gShowing = false;
      return;
    }
    forceAboutWelcomeOn();
    clearBrowserElements();
    initializeWelcome();
    window.addEventListener("keydown", onKeyDown, true);
    animateInitialStage();
  }

  function shouldShowWelcome() {
    return (
      !Services.prefs.getBoolPref(kSeenPref, false) &&
      !window.PrivateBrowsingUtils?.isWindowPrivate(window) &&
      window.toolbar?.visible !== false
    );
  }

  function isShownInOtherWindow() {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win !== window && win.gZenPickerWelcome?.showing) {
        return true;
      }
    }
    return false;
  }

  // Zen's own welcome page runs first, ours follows it.
  async function waitForZen() {
    for (let i = 0; i < 40; i++) {
      if (window.gZenUIManager?.motion && window.gZenWorkspaces) {
        await window.gZenWorkspaces.promiseInitialized;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const root = document.documentElement;
    if (!root.hasAttribute(kStageAttribute)) {
      return;
    }
    await new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!root.hasAttribute(kStageAttribute)) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: [kStageAttribute],
      });
    });
  }

  async function startWelcome() {
    if (!shouldShowWelcome()) {
      return;
    }
    await waitForZen();
    // No await between this check and showWelcome() setting gShowing, so
    // only one window can win.
    if (shouldShowWelcome() && !isShownInOtherWindow()) {
      showWelcome();
    }
  }

  window.gZenPickerWelcome = {
    show: showWelcome,
    get showing() {
      return gShowing;
    },
  };
  startWelcome();
})();