// ==UserScript==
// @name           BetterZenGradientPicker Welcome
// @version        2.0
// @description    Welcome page for BetterZenGradientPicker
// @author         JustAdumbPrsn
// @include        main
// ==/UserScript==

(function () {
  "use strict";

  if (window.gZenPickerWelcome) {
    return;
  }

  // Only readable while the script is being loaded, used to find welcome.css
  // next to this script.
  const kScriptURL = Components.stack.filename;

  // Set it back to false in about:config to see the welcome page again.
  const kSeenPref = "zen.better-gradient-picker.welcome-screen.seen";

  const kVideoURL =
    "chrome://browser/content/zen-videos/welcome-background.mp4";

  const kTitleLines = ["Better Zen", "Gradient Picker"];

  const kZenElementsToIgnore = ["zen-browser-background", "zen-toast-container"];

  const kSpring = { type: "spring", bounce: 0.35, visualDuration: 0.35 };
  const kExit = { duration: 0.12, ease: "easeIn" };
  const kFade = { duration: 0.25, ease: "easeOut" };

  const kNextButton = { label: "Next", primary: true };

  let gPages = null;
  let gClosing = false;
  let gShowing = false;
  let gColorsObserver = null;
  let gStyle = null;

  // Elements we hid in #browser, mapped to their previous inline display.
  const gHiddenElements = new Map();

  function getMotion() {
    return window.gZenUIManager?.motion;
  }

  // Without Zen's motion library, jump to the end state so nothing stays
  // invisible.
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
    const opacity = keyframes.opacity;
    for (const element of elements) {
      if (opacity !== undefined) {
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

  function parseXUL(xul) {
    return window.MozXULElement.parseXULToFragment(xul);
  }

  // The mod loader would load welcome.css
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

  // Hides the whole browser UI for the window
  function clearBrowserElements() {
    for (const element of document.getElementById("browser").children) {
      if (kZenElementsToIgnore.includes(element.id)) {
        continue;
      }
      gHiddenElements.set(element, element.style.display);
      element.style.display = "none";
    }
  }

  async function restoreBrowserElements() {
    const elements = [...gHiddenElements.keys()];
    for (const element of elements) {
      element.style.opacity = 0;
      element.style.display = gHiddenElements.get(element);
    }
    gHiddenElements.clear();
    window.gZenUIManager?.updateTabsToolbar?.();
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
    const video = document.getElementById("bgp-welcome-video");
    video.play().catch(() => {});
  }

  function removeVideoBackground() {
    const video = document.getElementById("bgp-welcome-video");
    if (!video) {
      return;
    }
    animate(video, { opacity: 0 }, { duration: 0.6, ease: "easeOut" }).then(
      () => {
        video.pause();
        video.remove();
      }
    );
  }

  async function closeWelcome() {
    if (gClosing) {
      return;
    }
    gClosing = true;
    Services.prefs.setBoolPref(kSeenPref, true);
    window.removeEventListener("keydown", onKeyDown, true);
    await animate("#bgp-welcome-root", { opacity: [1, 0] });
    document.getElementById("bgp-welcome-video")?.pause();
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

  class nsZenPickerWelcomePages {
    #index = -1;
    #pages;
    #content = null;

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

    get content() {
      return this.#content;
    }

    init() {
      document.getElementById("bgp-welcome-start").remove();
      const pages = document.getElementById("bgp-welcome-pages");
      pages.style.display = "flex";
      animate(pages, { opacity: [0, 1] }, { ...kFade, duration: 0.45 });
      this.backButton.addEventListener("click", () => this.back());
    }

    next() {
      this.currentPage?.commit?.(this.#content);
      this.#show(this.#index + 1, 1);
    }

    back() {
      if (this.#index <= 0) {
        return;
      }
      this.#show(this.#index - 1, -1);
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
        // Ran past the last page. Keep the index on it so finish() can
        // still run its leave() and close the picker panel.
        this.finish();
        return;
      }
      this.#index = index;
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
      const text = document.createElement("div");
      text.className = "bgp-welcome-text";
      const title = document.createElement("h1");
      title.textContent = page.title;
      text.appendChild(title);
      for (const description of page.descriptions ?? []) {
        const p = document.createElement("p");
        p.textContent = description;
        text.appendChild(p);
      }
      this.textContainer.appendChild(text);
      animate(
        [...text.children],
        { opacity: [0, 1], x: [120 * direction, 0] },
        {
          ...kSpring,
          bounce: 0.4,
          visualDuration: 0.3,
          delay: stagger(0.03),
        }
      );
    }

    #renderContent(page) {
      const content = document.createElement("div");
      content.className = "bgp-welcome-page";
      if (page.id) {
        content.setAttribute("page", page.id);
      }
      page.render?.(content, this);
      this.contentContainer.appendChild(content);
      this.#content = content;
      animate(content, { opacity: [0, 1] }, kFade);
    }

    #renderButtons(page) {
      const fragment = document.createDocumentFragment();
      for (const button of page.buttons ?? [kNextButton]) {
        const element = document.createElement("button");
        element.className = button.primary
          ? "zen-big-accent-button primary"
          : "zen-big-accent-button";
        element.textContent = button.label;
        element.addEventListener("click", () => {
          if (button.onclick?.(this) !== false) {
            this.next();
          }
        });
        fragment.appendChild(element);
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

  // Page fields: id, title, descriptions, buttons, render(content, pages) and
  // the optional commit(content), leave() and skip(). Buttons default to a
  // single "Next" button.
  function getWelcomePages() {
    return [
      {
        id: "colors",
        title: "Play around!",
        descriptions: [
          "Pick the colors that feel right for your workspace.",
          "Click the heart icon to save the gradient!.",
          "Your saves will be visible in the gradient list.",
          "You can reopen the gradient picker and change it any time.",
        ],
        // Nothing to show if Zen's theme picker is missing.
        skip() {
          return !window.gZenThemePicker;
        },
        render(content) {
          removeVideoBackground();
          const anchor = document.createElement("div");
          anchor.id = "bgp-welcome-workspace-colors-anchor";
          content.appendChild(anchor);
          const panel = gZenThemePicker.panel;
          panel.setAttribute("noautohide", "true");
          panel.setAttribute("consumeoutsideclicks", "false");
          panel.setAttribute("nonnative", "");
          let lastSize = "";
          const sizeAnchor = () => {
            const panelRect = panel.getBoundingClientRect();
            // 20 is the shadow width * 2
            anchor.style.height =
              panelRect.height -
              (AppConstants.platform == "macosx" ? -90 : 20) +
              "px";
            anchor.style.width = panelRect.width - 20 + "px";
            lastSize = `${panelRect.width}x${panelRect.height}`;
          };
          panel.addEventListener("popupshowing", sizeAnchor, { once: true });
          // The picker grows after it opens, so keep the anchor (which is
          // centered by the page) in sync with it.
          gColorsObserver = new ResizeObserver(() => {
            const panelRect = panel.getBoundingClientRect();
            if (lastSize == `${panelRect.width}x${panelRect.height}`) {
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
          const panel = gZenThemePicker.panel;
          panel.removeAttribute("noautohide");
          panel.removeAttribute("consumeoutsideclicks");
          panel.removeAttribute("nonnative");
          animate(panel, { opacity: [1, 0] }, kExit).then(() => {
            panel.hidePopup();
            panel.removeAttribute("style");
          });
        },
      },
      {
        id: "finish",
        title: "You're all set",
        descriptions: [
          "The mod is ready. Open the gradient picker any time to change things up.",
        ],
        buttons: [{ label: "Start exploring", primary: true }],
      },
    ];
  }

  async function animateInitialStage() {
    const titleElement = document.getElementById("bgp-welcome-title");
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
        lineElement.appendChild(charElement);
      }
      titleElement.appendChild(lineElement);
    }
    const chars = titleElement.querySelectorAll(".bgp-welcome-char");
    await animate(
      chars,
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
          {
            duration: 0.3,
            ease: "easeIn",
            delay: stagger(0.012),
          }
        );
        gPages = new nsZenPickerWelcomePages(getWelcomePages());
      },
      { once: true }
    );
    await animate(
      button,
      { opacity: [0, 1], y: [20, 0], filter: ["blur(2px)", "blur(0px)"] },
      {
        delay: 0.1,
        type: "spring",
        stiffness: 300,
        damping: 20,
        mass: 1.8,
      }
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

  // The welcome page should only run once, even with several windows open.
  function isShownInOtherWindow() {
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      if (win !== window && win.gZenPickerWelcome?.showing) {
        return true;
      }
    }
    return false;
  }

  async function waitForZen() {
    for (let i = 0; i < 40; i++) {
      if (window.gZenUIManager?.motion && window.gZenWorkspaces) {
        await window.gZenWorkspaces.promiseInitialized;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    // Zen's own welcome page runs first, ours follows it.
    const root = document.documentElement;
    if (!root.hasAttribute("zen-welcome-stage")) {
      return;
    }
    await new Promise(resolve => {
      const observer = new MutationObserver(() => {
        if (!root.hasAttribute("zen-welcome-stage")) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["zen-welcome-stage"],
      });
    });
  }

  async function startWelcome() {
    if (!shouldShowWelcome()) {
      return;
    }
    await waitForZen();
    // Another window may have finished the welcome page in the meantime, or
    // be showing it right now. There is no await between this check and
    // showWelcome() setting gShowing, so only one window can ever win.
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