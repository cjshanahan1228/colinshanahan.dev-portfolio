/* Theme selection for colinshanahan.dev.
   Loaded synchronously in <head> on purpose: the stored choice has to be on
   <html> before first paint, or the page flashes the wrong theme. The toggle
   itself is injected rather than written into each page's markup — four
   different header layouts to keep in sync, and a button that does nothing
   without JS is worse than no button. */
(function () {
  var KEY = "theme";
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");
  var btn = null;

  var MOON =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 13.5A8 8 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  var SUN =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6L17 17M7 7L5.4 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  // Before paint: honour a stored choice. No choice stored means the CSS
  // media query decides, so nothing is set here.
  try {
    var saved = localStorage.getItem(KEY);
    if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved);
  } catch (e) {
    /* private mode / storage disabled — fall back to the OS preference */
  }

  function current() {
    return root.getAttribute("data-theme") || (media.matches ? "dark" : "light");
  }

  function sync() {
    if (!btn) return;
    var dark = current() === "dark";
    var label = dark ? "Switch to light theme" : "Switch to dark theme";
    btn.innerHTML = dark ? SUN : MOON;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    btn.title = label;
  }

  function apply(theme) {
    root.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* choice lasts for this page only */
    }
    sync();
  }

  function mount() {
    var header = document.querySelector("header");
    if (!header) return;
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    btn.id = "themeToggle";
    btn.addEventListener("click", function () {
      apply(current() === "dark" ? "light" : "dark");
    });
    // Nav-bar pages have a flex row to sit in. The others (architecture,
    // status) have a block header, where appending would drop the button
    // below the intro text — so it gets pinned to the header's top-right.
    var bar = header.querySelector(".top-inner");
    var host = bar || header.querySelector(".wrap") || header;
    if (!bar) {
      btn.className += " theme-toggle--float";
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
    }
    host.appendChild(btn);
    sync();
    mountNav(header, host, !bar);
  }

  // ---- mobile navigation -------------------------------------------------
  // Below 760px the pages hide their inline nav (it can't fit) — this replaces
  // it with a disclosure button + panel listing every page. Links are absolute
  // so one list serves all four pages. Pattern: button[aria-expanded]
  // controlling a <nav>; focus moves to the first link on open, Escape /
  // outside click / link click / focus leaving / resize past the breakpoint
  // close it. CSS (theme.css) owns visibility, so this is inert on desktop.
  var LINKS = [
    ["Home", "/"],
    ["Case studies", "/case-studies"],
    ["Architecture", "/architecture"],
    ["Status", "/status"],
    ["Experience", "/#experience"],
    ["Projects", "/#projects"],
    ["Skills", "/#skills"],
    ["Console", "/#console"],
    ["Contact", "/#contact"],
  ];
  var BARS =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var CLOSE =
    '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  function mountNav(header, host, floated) {
    var open = false;
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-toggle" + (floated ? " nav-toggle--float" : "");
    toggle.id = "navToggle";
    toggle.setAttribute("aria-label", "Menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "siteNav");
    toggle.innerHTML = BARS;

    var panel = document.createElement("nav");
    panel.id = "siteNav";
    panel.className = "site-nav" + (floated ? " site-nav--float" : "");
    panel.setAttribute("aria-label", "Site");
    panel.hidden = true;
    var list = document.createElement("ul");
    var path = location.pathname.replace(/\/+$/, "") || "/";
    LINKS.forEach(function (l, i) {
      var li = document.createElement("li");
      if (i === 4) li.className = "site-nav__sep";
      var a = document.createElement("a");
      a.href = l[1];
      a.textContent = l[0];
      if (l[1] === path || (path === "/index.html" && l[1] === "/")) a.setAttribute("aria-current", "page");
      li.appendChild(a);
      list.appendChild(li);
    });
    panel.appendChild(list);

    function setOpen(next, returnFocus) {
      open = next;
      panel.hidden = !next;
      toggle.setAttribute("aria-expanded", next ? "true" : "false");
      toggle.innerHTML = next ? CLOSE : BARS;
      if (next) {
        var first = panel.querySelector("a");
        if (first) first.focus();
      } else if (returnFocus) {
        toggle.focus();
      }
    }

    toggle.addEventListener("click", function () {
      setOpen(!open, true);
    });
    // Navigating (same-page anchors included) should dismiss the panel.
    panel.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) setOpen(false, false);
    });
    document.addEventListener("keydown", function (e) {
      if (open && e.key === "Escape") setOpen(false, true);
    });
    document.addEventListener("click", function (e) {
      // composedPath, not contains(target): the toggle swaps its own icon on
      // click, so by now e.target may already be detached from the header.
      if (open && e.composedPath().indexOf(header) === -1) setOpen(false, false);
    });
    header.addEventListener("focusout", function (e) {
      if (open && e.relatedTarget && !header.contains(e.relatedTarget)) setOpen(false, false);
    });
    var wide = window.matchMedia("(min-width: 761px)");
    var onWide = function () {
      if (open && wide.matches) setOpen(false, false);
    };
    if (wide.addEventListener) wide.addEventListener("change", onWide);

    host.appendChild(toggle);
    host.appendChild(panel);
    root.classList.add("has-site-nav");
  }

  // Keep the icon honest if the OS flips while the visitor has no explicit choice.
  if (media.addEventListener) media.addEventListener("change", sync);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
