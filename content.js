"use strict";

// Gramular content script.
//
// A small "G" bubble appears beside any eligible text field the moment it
// receives focus. Clicking the bubble opens a panel with Check / Prompt
// actions. The panel positions itself context-aware so it never clips outside
// the viewport.

(function () {
  if (window.__gramularInjected) return;
  window.__gramularInjected = true;

  const NS = "gramular";
  let enabled = true;

  // Read the enabled flag and keep it in sync.
  browser.storage.local.get(["enabled"]).then((d) => {
    enabled = d && d.enabled !== false;
    // If an eligible field already has focus, show the bubble now.
    if (enabled && isEligible(document.activeElement)) {
      showBubbleFor(document.activeElement);
    }
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) {
      enabled = changes.enabled.newValue !== false;
      if (!enabled) destroyUI();
    }
  });

  // Handle keyboard commands forwarded from the background script.
  browser.runtime.onMessage.addListener((message) => {
    if (!message || !enabled) return;

    if (message.action === "gramular:cmd:quick-fix") {
      const field = document.activeElement;
      if (isEligible(field)) {
        showBubbleFor(field);
        openPanel();
        runImprove();
      }
      return;
    }

    if (message.action === "gramular:cmd:prompt-mode") {
      const field = document.activeElement;
      if (isEligible(field)) {
        showBubbleFor(field);
        openPanel();
        if (ui.promptWrap.classList.contains(`${NS}-hidden`)) {
          togglePromptInput();
        }
        requestAnimationFrame(() => ui.promptInput.focus());
      }
      return;
    }
  });

  // --- Eligibility ----------------------------------------------------------

  const SAFE_INPUT_TYPES = new Set(["text", "search", ""]);

  const SENSITIVE_INPUT_TYPES = new Set([
    "password",
    "email",
    "url",
    "tel",
    "number",
    "date",
    "datetime-local",
    "month",
    "week",
    "time",
    "color",
    "range",
    "file",
    "hidden",
    "checkbox",
    "radio",
    "submit",
    "button",
    "image",
    "reset",
  ]);

  const SENSITIVE_TOKENS = [
    "pass",
    "password",
    "pwd",
    "user",
    "username",
    "login",
    "email",
    "url",
    "uri",
    "address",
    "phone",
    "tel",
    "ssn",
    "social",
    "credit",
    "card",
    "cc-",
    "cvc",
    "cvv",
    "secret",
    "token",
    "otp",
    "code",
    "pin",
    "search",
    "captcha",
  ];

  function looksSensitive(elm) {
    const hay = [
      elm.getAttribute("name") || "",
      elm.id || "",
      elm.getAttribute("autocomplete") || "",
      elm.getAttribute("aria-label") || "",
      elm.getAttribute("placeholder") || "",
    ]
      .join(" ")
      .toLowerCase();
    return SENSITIVE_TOKENS.some((t) => hay.includes(t));
  }

  function isEligible(elm) {
    if (!elm || elm.nodeType !== 1) return false;
    if (elm.closest(`.${NS}-root`)) return false;
    if (elm.disabled || elm.readOnly) return false;

    const tag = elm.tagName;

    if (tag === "TEXTAREA") {
      return !looksSensitive(elm);
    }

    if (tag === "INPUT") {
      const type = (elm.getAttribute("type") || "text").toLowerCase();
      if (SENSITIVE_INPUT_TYPES.has(type)) return false;
      if (!SAFE_INPUT_TYPES.has(type)) return false;
      if (type === "search") return false;
      return !looksSensitive(elm);
    }

    if (elm.isContentEditable) {
      const host = elm.closest("[contenteditable]") || elm;
      return !looksSensitive(host);
    }

    return false;
  }

  // --- Reading / writing field text -----------------------------------------

  function getFieldText(elm) {
    if (elm.tagName === "TEXTAREA" || elm.tagName === "INPUT") {
      return elm.value || "";
    }
    if (elm.isContentEditable) {
      return elm.innerText || "";
    }
    return "";
  }

  // Re-entrancy guard. Replacing field text fires input/change/selection
  // events that some pages bounce back into our handlers; without this lock a
  // second call can land before the first finishes, doubling the inserted text
  // (e.g. "HelloHello"). The lock is released on the next tick, after the
  // synchronous insertion and its event cascade have settled.
  let replacingField = false;

  function setFieldText(elm, text) {
    if (replacingField) return;
    replacingField = true;
    try {
      doSetFieldText(elm, text);
    } finally {
      setTimeout(() => {
        replacingField = false;
      }, 0);
    }
  }

  function doSetFieldText(elm, text) {
    if (elm.tagName === "TEXTAREA" || elm.tagName === "INPUT") {
      elm.focus();

      // Select the entire current value, then replace it through the browser's
      // native editing pipeline. Going through execCommand/setRangeText (rather
      // than directly assigning .value) keeps framework value-trackers (React,
      // Vue, etc.) in sync, so the field stays editable afterward.
      try {
        elm.select();
      } catch (_) {
        /* some inputs don't support select(); fall through */
      }

      let inserted = false;
      try {
        // insertText replaces the current selection and fires a proper
        // beforeinput/input sequence that frameworks listen to.
        inserted = document.execCommand("insertText", false, text);
      } catch (_) {
        inserted = false;
      }

      // Some browsers (notably Firefox) return false from execCommand even
      // though the text was actually inserted. Guard against double-insertion
      // by checking whether the value already matches before falling back.
      if (!inserted && elm.value !== text) {
        // Fallback: setRangeText over the whole value, then notify.
        try {
          elm.setRangeText(text, 0, elm.value.length, "end");
        } catch (_) {
          // Last-resort fallback: native value setter.
          const proto =
            elm.tagName === "TEXTAREA"
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
          setter.call(elm, text);
        }
        elm.dispatchEvent(new Event("input", { bubbles: true }));
        elm.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Place the caret at the end so the user can keep typing immediately.
      try {
        const end = elm.value.length;
        elm.setSelectionRange(end, end);
      } catch (_) {
        /* selection API not available on this input type; ignore */
      }
    } else if (elm.isContentEditable) {
      // Resolve the actual contenteditable host (elm may be a nested node).
      const host =
        elm.closest("[contenteditable]") || elm;
      host.focus();

      const sel = window.getSelection();

      // Some editors (notably Draft.js, used by x.com/twitter and Facebook)
      // keep their own internal model and only stay in sync when content
      // arrives through their event handlers. execCommand("insertText") leaves
      // Draft's selection state disagreeing with the DOM, which makes the caret
      // jump back to the start and the field effectively uneditable.
      //
      // Draft's paste handler (editOnPaste) replaces *its own* internal
      // selection (editorState.getSelection()) with the pasted text -- it does
      // NOT look at the DOM selection. After we force-focus, that internal
      // selection is collapsed at the end, so a plain paste appends.
      //
      // Draft keeps its internal selection in sync with the DOM via its
      // onSelect handler (editOnSelect), which React wires to the native
      // `selectionchange` event and processes asynchronously. So to make the
      // paste replace everything we must:
      //   1. set the DOM selection to span all content,
      //   2. let Draft's onSelect run on a later tick to absorb that selection
      //      into its editorState,
      //   3. then dispatch the paste.
      if (isDraftEditor(host)) {
        replaceDraftContent(host, text);
        return;
      }

      // For all other contenteditable fields, select everything via the DOM
      // then replace with insertText.
      document.execCommand("selectAll", false, null);

      let ok = false;
      try {
        ok = document.execCommand("insertText", false, text);
      } catch (_) {
        ok = false;
      }

      // Some browsers (notably Firefox) return false from execCommand even
      // though the text was actually inserted. Guard against double-insertion
      // by checking whether the content already matches before falling back.
      if (!ok && (host.innerText || "").trim() !== text.trim()) {
        // Fallback: clear via a Range, then insert a text node directly.
        try {
          const range = document.createRange();
          range.selectNodeContents(host);
          sel.removeAllRanges();
          sel.addRange(range);
          range.deleteContents();
          range.insertNode(document.createTextNode(text));
        } catch (_) {
          host.textContent = text;
        }
        host.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
        );
      }

      // Collapse the caret to the end using the *live* selection so it points
      // at a valid, attached node rather than a stale range.
      try {
        const endRange = document.createRange();
        endRange.selectNodeContents(host);
        endRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(endRange);
      } catch (_) {
        /* selection API unavailable; ignore */
      }
    }
  }

  // Set the DOM selection to span all of the host's content, then notify
  // Draft so its onSelect handler (editOnSelect) absorbs that selection into
  // its internal editorState. editOnSelect is a React onSelect handler, which
  // React fires from the native `selectionchange` event.
  function selectAllAndSyncDraft(host) {
    const sel = window.getSelection();
    try {
      const range = document.createRange();
      range.selectNodeContents(host);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) {
      try {
        document.execCommand("selectAll", false, null);
      } catch (__) {
        /* give up; insert will append */
      }
    }
    // Drive Draft's editOnSelect. React's synthetic onSelect listens on the
    // document's `selectionchange`; older wiring used `select` on the element.
    try {
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    } catch (_) {}
    try {
      host.dispatchEvent(new Event("select", { bubbles: true }));
    } catch (_) {}
  }

  // Replace the entire content of a Draft.js editor with `text`.
  //
  // Mechanism (verified against Draft.js source):
  //   * editOnPaste / editOnBeforeInput both replace `editorState.getSelection()`
  //     -- Draft's *internal* selection, not the DOM selection.
  //   * After we focus the field, that internal selection is collapsed at the
  //     end, so a naive insert/paste appends.
  //   * Draft syncs its internal selection from the DOM in editOnSelect, which
  //     React fires from `selectionchange`. But editOnSelect bails while
  //     `_blockSelectEvents` is true (set during Draft's render and cleared in
  //     componentDidUpdate) or while a state update is pending.
  //
  // So: focus, let Draft settle, set the DOM selection to all + fire
  // selectionchange so editOnSelect runs, let that state update flush, then
  // insert. We use the real DOM focus (host.focus) -- NOT Draft's own focus()
  // which would force-restore its collapsed selection. Several frames of
  // settling make this robust; we verify and fall back if needed.
  function replaceDraftContent(host, text) {
    // Use the DOM focus only (Draft's .focus() would forceSelection back to
    // its collapsed internal selection and undo our select-all).
    host.focus();

    // Give Draft a couple of frames to finish any render triggered by focus,
    // so _blockSelectEvents is false when our selectionchange arrives.
    requestAnimationFrame(() => {
      selectAllAndSyncDraft(host);

      // Let editOnSelect's resulting editorState update flush.
      requestAnimationFrame(() => {
        // Re-assert just before inserting in case a render moved selection.
        selectAllAndSyncDraft(host);

        requestAnimationFrame(() => {
          let ok = false;
          try {
            ok = document.execCommand("insertText", false, text);
          } catch (_) {
            ok = false;
          }

          // Verify the editor now contains exactly the new text. innerText of
          // an empty-then-filled Draft block can have a trailing newline.
          // Draft re-renders asynchronously, so wait a frame before reading
          // host.innerText -- otherwise the comparison can wrongly fail and we
          // paste a SECOND time, doubling the text (e.g. "HelloHello").
          const norm = (s) => (s || "").replace(/\u200b/g, "").replace(/\s+$/, "");
          requestAnimationFrame(() => {
            if (norm(host.innerText) === norm(text)) return; // already correct
            // Fallback: re-select all and paste through Draft's paste handler.
            selectAllAndSyncDraft(host);
            requestAnimationFrame(() => {
              selectAllAndSyncDraft(host);
              dispatchSyntheticPaste(host, text);
            });
          });
        });
      });
    });
  }

  // Detect a Draft.js-backed editor. Draft annotates its DOM with
  // data-* hooks; x.com/twitter and Facebook both use it.
  function isDraftEditor(host) {
    try {
      return !!(
        host.closest('[data-contents="true"]') ||
        host.querySelector('[data-contents="true"]') ||
        host.closest(".DraftEditor-root") ||
        host.querySelector('[data-block="true"]')
      );
    } catch (_) {
      return false;
    }
  }

  // Inject text by faking a paste event with a real DataTransfer payload.
  // Draft.js (and most modern editors) route paste through their own
  // handlers, so the editor's internal state stays consistent and the field
  // remains fully editable afterwards. Assumes the target selection is already
  // set (e.g. selectAll for a full replace).
  function dispatchSyntheticPaste(host, text) {
    try {
      const evt = new ClipboardEvent("paste", {
        clipboardData: new DataTransfer(),
        bubbles: true,
        cancelable: true,
        composed: true,
      });

      // In Firefox content scripts the event lives behind an Xray wrapper, so
      // data written to the wrapper's DataTransfer is invisible to the page's
      // paste handler (it reads an empty string). Writing through
      // wrappedJSObject puts the data on the underlying page-visible object so
      // Draft.js actually receives it. On Chromium there is no wrappedJSObject
      // and the regular clipboardData works.
      const target = evt.wrappedJSObject || evt;
      if (target.clipboardData) {
        target.clipboardData.setData("text/plain", text);
      } else {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        Object.defineProperty(evt, "clipboardData", { value: dt });
      }

      // If after all this the data still isn't set, bail so the caller falls
      // back to insertText rather than silently inserting nothing. Read through
      // the same object we wrote to (the page-visible one under Xray).
      let readable = "";
      try {
        readable = target.clipboardData
          ? target.clipboardData.getData("text/plain")
          : evt.clipboardData.getData("text/plain");
      } catch (_) {
        readable = "";
      }
      if (!readable) return false;

      host.dispatchEvent(evt);
      return true;
    } catch (_) {
      return false;
    }
  }

  // --- State ----------------------------------------------------------------

  let currentField = null;
  let ui = null; // { root, bubble, panel, ... }
  let suppressBubble = false; // true for one focusin cycle after Escape

  // --- UI construction ------------------------------------------------------

  function buildUI() {
    if (ui) return ui;

    const root = document.createElement("div");
    root.className = `${NS}-root`;
    root.setAttribute("aria-hidden", "false");

    const bubble = document.createElement("button");
    bubble.type = "button";
    bubble.className = `${NS}-bubble`;
    bubble.title = "Gramular";
    bubble.setAttribute("aria-label", "Open Gramular");
    // Pencil / edit icon.
    bubble.innerHTML = `
      <svg class="${NS}-bubble-icon" viewBox="0 0 24 24" width="15" height="15"
        fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 20h9"></path>
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
      </svg>`;

    const panel = document.createElement("div");
    panel.className = `${NS}-panel ${NS}-hidden`;

    panel.innerHTML = `
      <div class="${NS}-panel-head">
        <span class="${NS}-panel-title">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"
            stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>
          </svg>
          Gramular
        </span>
        <button type="button" class="${NS}-x" aria-label="Close">&times;</button>
      </div>
      <div class="${NS}-actions">
        <button type="button" class="${NS}-action ${NS}-action-improve" data-act="improve">Quick Fix</button>
        <button type="button" class="${NS}-action" data-act="prompt">Prompt</button>
      </div>
      <div class="${NS}-prompt-wrap ${NS}-hidden">
        <textarea class="${NS}-prompt-input" rows="2"
          placeholder="How should this text be edited? e.g. make it more formal"></textarea>
        <button type="button" class="${NS}-run">Run</button>
      </div>
      <div class="${NS}-status ${NS}-hidden"></div>
      <div class="${NS}-result-wrap ${NS}-hidden">
         <div class="${NS}-result" contenteditable="false"></div>
       </div>
    `;

    root.appendChild(bubble);
    root.appendChild(panel);
    document.body.appendChild(root);

    ui = {
      root,
      bubble,
      panel,
      x: panel.querySelector(`.${NS}-x`),
      actions: panel.querySelectorAll(`.${NS}-action`),
      promptWrap: panel.querySelector(`.${NS}-prompt-wrap`),
      promptInput: panel.querySelector(`.${NS}-prompt-input`),
      runBtn: panel.querySelector(`.${NS}-run`),
      status: panel.querySelector(`.${NS}-status`),
      resultWrap: panel.querySelector(`.${NS}-result-wrap`),
      result: panel.querySelector(`.${NS}-result`),
    };

    wireUI(ui);
    return ui;
  }

  function wireUI(u) {
    // Stop propagation AND prevent default on all mousedown events that
    // originate inside our root. Sites like x.com use capture-phase mousedown
    // listeners to manage their modal focus; letting those fire causes the
    // compose field to blur and our UI to tear down mid-click. preventDefault
    // also stops the browser from shifting focus away from the field.
    u.root.addEventListener(
      "mousedown",
      (e) => {
        e.stopPropagation();
        // Keep the prompt textarea focusable; block focus shifts elsewhere.
        if (e.target !== u.promptInput) e.preventDefault();
      },
      true,
    );

    u.bubble.addEventListener("click", (e) => {
      e.stopPropagation();
      openPanel();
    });

    u.x.addEventListener("click", (e) => {
      e.stopPropagation();
      closePanel();
    });

    u.actions.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.getAttribute("data-act");
        if (act === "improve") runImprove();
        else if (act === "prompt") togglePromptInput();
      });
    });

    u.promptInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        runPrompt();
      }
    });

    u.runBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      runPrompt();
    });

    u.panel.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  // --- Positioning ----------------------------------------------------------
  //
  // The root uses position:fixed so coordinates are always viewport-relative.
  // No scrollX/scrollY arithmetic needed — positionUI() is called on every
  // scroll/resize so the bubble stays locked to the field.

  function positionUI() {
    if (!ui || !currentField) return;

    const fieldRect = currentField.getBoundingClientRect();
    const gap = 6;

    // Always right of field, top-aligned, purely in viewport space.
    ui.root.style.top  = `${fieldRect.top}px`;
    ui.root.style.left = `${fieldRect.right + gap}px`;

    // If panel is open, recompute its placement too.
    if (!ui.panel.classList.contains(`${NS}-hidden`)) {
      positionPanel();
    }
  }

  function measurePanel() {
    // Temporarily reveal the panel (invisibly) so we can measure it.
    const wasHidden = ui.panel.classList.contains(`${NS}-hidden`);
    if (wasHidden) {
      ui.panel.style.visibility = "hidden";
      ui.panel.classList.remove(`${NS}-hidden`);
    }
    const rect = ui.panel.getBoundingClientRect();
    if (wasHidden) {
      ui.panel.classList.add(`${NS}-hidden`);
      ui.panel.style.visibility = "";
    }
    return { width: rect.width || 280, height: rect.height || 200 };
  }

  function positionPanel() {
    if (!ui || ui.panel.classList.contains(`${NS}-hidden`)) return;

    const rootRect = ui.root.getBoundingClientRect();
    const bubbleRect = ui.bubble.getBoundingClientRect();
    const { width: panelW, height: panelH } = measurePanel();
    const gap = 6;
    const pad = 8; // minimum distance from viewport edge

    // Desired panel position in viewport coordinates.
    // Default: to the right of the bubble, aligned vertically with bubble top.
    let desiredLeft = bubbleRect.right + gap;
    let desiredTop = bubbleRect.top;

    // Not enough room on the right -> flip to left of bubble.
    if (desiredLeft + panelW > window.innerWidth - pad) {
      desiredLeft = bubbleRect.left - panelW - gap;
    }

    // Not enough room below -> shift up so the panel fits.
    if (desiredTop + panelH > window.innerHeight - pad) {
      desiredTop = window.innerHeight - panelH - pad;
    }

    // Clamp to viewport edges.
    desiredLeft = Math.max(pad, Math.min(desiredLeft, window.innerWidth - panelW - pad));
    desiredTop = Math.max(pad, Math.min(desiredTop, window.innerHeight - panelH - pad));

    // Convert to root-relative coordinates.
    ui.panel.style.left = `${desiredLeft - rootRect.left}px`;
    ui.panel.style.top = `${desiredTop - rootRect.top}px`;
  }

  // --- Panel open / close ---------------------------------------------------

  function openPanel() {
    if (!ui) return;
    ui.panel.classList.remove(`${NS}-hidden`);
    ui.bubble.classList.add(`${NS}-bubble-active`);
    positionPanel();
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.classList.add(`${NS}-hidden`);
    ui.bubble.classList.remove(`${NS}-bubble-active`);
    resetPanelState();
  }

  function resetPanelState() {
    if (!ui) return;
    ui.promptWrap.classList.add(`${NS}-hidden`);
    ui.promptInput.value = "";
    hideStatus();
    ui.resultWrap.classList.add(`${NS}-hidden`);
    ui.result.textContent = "";
  }

  function togglePromptInput() {
    ui.promptWrap.classList.toggle(`${NS}-hidden`);
    if (!ui.promptWrap.classList.contains(`${NS}-hidden`)) {
      ui.promptInput.focus();
    }
  }

  // --- Status / busy --------------------------------------------------------

  function setStatus(msg, kind) {
    ui.status.textContent = msg;
    ui.status.className = `${NS}-status` + (kind ? ` ${NS}-status-${kind}` : "");
    ui.status.classList.remove(`${NS}-hidden`);
  }

  function hideStatus() {
    ui.status.classList.add(`${NS}-hidden`);
    ui.status.textContent = "";
  }

  function setBusy(on) {
    ui.actions.forEach((b) => (b.disabled = on));
    ui.runBtn.disabled = on;
  }

  // --- Running actions ------------------------------------------------------

  async function runImprove() {
    if (!currentField) return;
    const text = getFieldText(currentField).trim();
    if (!text) {
      setStatus("The field is empty.", "err");
      return;
    }
    setBusy(true);
    setStatus("Improving…", "");
    try {
      const resp = await browser.runtime.sendMessage({
        action: "gramular:check",
        text,
      });
      if (!resp) {
        setStatus("No response from Gramular.", "err");
        return;
      }
      if (!resp.ok) {
        setStatus(resp.error || "Something went wrong.", "err");
        return;
      }
      // Auto-replace the field text and close the panel.
      const field = currentField;
      closePanel();
      setFieldText(field, resp.text);
      field.focus();
    } catch (err) {
      setStatus(`Error: ${err.message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  async function runPrompt() {
    if (!currentField) return;
    const text = getFieldText(currentField).trim();
    const prompt = ui.promptInput.value.trim();
    if (!text) {
      setStatus("The field is empty.", "err");
      return;
    }
    if (!prompt) {
      setStatus("Enter a prompt first.", "err");
      return;
    }
    setBusy(true);
    setStatus("Working…", "");
    try {
      const resp = await browser.runtime.sendMessage({
        action: "gramular:prompt",
        text,
        prompt,
      });
      handleResponse(resp);
    } catch (err) {
      setStatus(`Error: ${err.message}`, "err");
    } finally {
      setBusy(false);
    }
  }

  function handleResponse(resp) {
    if (!resp) {
      setStatus("No response from Gramular.", "err");
      return;
    }
    if (!resp.ok) {
      setStatus(resp.error || "Something went wrong.", "err");
      return;
    }
    hideStatus();
    const text = resp.text;
    // Auto-apply the result instead of showing a menu
    closePanel();
    setFieldText(currentField, text);
    currentField.focus();
  }

  // --- Show / hide bubble ---------------------------------------------------

  function showBubbleFor(field) {
    currentField = field;
    buildUI();
    ui.root.classList.add(`${NS}-visible`);
    positionUI();
  }

  function destroyUI() {
    if (ui) {
      ui.root.remove();
      ui = null;
    }
    currentField = null;
  }

  function hideUI() {
    if (ui) {
      ui.root.classList.remove(`${NS}-visible`);
      closePanel();
    }
    currentField = null;
  }

  // --- Event wiring ---------------------------------------------------------

  // Show bubble immediately when an eligible field gains focus.
  // Use window (not document) in capture phase so we see focus events even if
  // X.com's own capture handlers call stopPropagation at the document level.
  window.addEventListener(
    "focusin",
    (e) => {
      if (!enabled) return;
      if (suppressBubble) { suppressBubble = false; return; }
      const t = e.target;

      // Focus moved into our own UI — ignore.
      if (ui && ui.root.contains(t)) return;

      // Focus moved to the same field — just ensure placement.
      if (t === currentField) {
        positionUI();
        return;
      }

      // Focus moved to a DIFFERENT eligible field — switch to it.
      if (isEligible(t)) {
        if (ui) closePanel();
        currentField = null;
        if (ui) ui.root.classList.remove(`${NS}-visible`);
        showBubbleFor(t);
        return;
      }

      // Focus moved to a NON-eligible element (e.g. x.com programmatically
      // focusing its own close button while the user clicks our UI). Do NOT
      // tear down the bubble here — that would close the panel the instant the
      // user interacts with it. We keep the bubble tied to currentField; an
      // actual dismissal happens via the outside-click mousedown handler or
      // Escape. This is the key fix for the x.com floating compose dialog.
    },
    true,
  );

  // Reposition bubble while typing (in case layout shifts).
  window.addEventListener(
    "input",
    (e) => {
      if (!enabled) return;
      const target = e.target;
      if (!isEligible(target)) return;
      if (ui && currentField === target) {
        positionUI();
      }
    },
    true,
  );

  // Keep bubble in place on scroll / resize.
  window.addEventListener(
    "scroll",
    () => {
      if (ui && ui.root.classList.contains(`${NS}-visible`)) positionUI();
    },
    true,
  );
  window.addEventListener("resize", () => {
    if (ui && ui.root.classList.contains(`${NS}-visible`)) positionUI();
  });

  // Dismiss only when clicking outside both the current field and our UI.
  window.addEventListener("mousedown", (e) => {
    if (!ui) return;
    // Inside our UI — keep open.
    if (ui.root.contains(e.target)) return;
    // Inside the currently tracked field — keep open.
    if (currentField && currentField.contains(e.target)) return;
    // Clicking directly on an eligible field (e.g. the user clicks the compose
    // box before focusin has fired and set currentField) — keep open so the
    // bubble can appear once focusin arrives.
    const clickedField = e.target.closest
      ? e.target.closest("[contenteditable], textarea, input")
      : null;
    if (clickedField && isEligible(clickedField)) return;
    hideUI();
  });

  // Escape closes the bubble while leaving the field focused and the caret
  // exactly where it was. We only close the panel and hide the bubble visually
  // (without destroying it or moving focus), so the editor's own selection
  // state is never disturbed — this avoids corrupting rich editors like Draft.js
  // (x.com) where forcing a DOM selection breaks subsequent editing.
  //
  // Use the capture phase on window so we see the event even when the host page
  // calls stopPropagation() on Escape at the document level.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && ui && ui.root.classList.contains(`${NS}-visible`)) {
        closePanel();
        ui.root.classList.remove(`${NS}-visible`);
        // Drop the tracked field so the bubble reappears the next time the user
        // clicks or refocuses the field (handled by the focusin listener).
        // We never blur or move the caret, so the editor's selection state and
        // caret position are left completely intact.
        currentField = null;
      }
    },
    true,
  );
})();
