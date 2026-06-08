/* Uke Can Do It! — small progressive-enhancement script
   - sticky nav border on scroll
   - mobile nav toggle
   - scroll-reveal via IntersectionObserver
   No dependencies, no build step. */

(function () {
  "use strict";

  var nav = document.getElementById("nav");
  var toggle = document.getElementById("navToggle");
  var links = document.getElementById("navLinks");
  var analyzeForm = document.getElementById("analyzeForm");
  var audioFile = document.getElementById("audioFile");
  var fileName = document.getElementById("fileName");
  var analyzeButton = document.getElementById("analyzeButton");
  var analyzeStatus = document.getElementById("analyzeStatus");
  var tempoValue = document.getElementById("tempoValue");
  var chordCountValue = document.getElementById("chordCountValue");
  var onsetCountValue = document.getElementById("onsetCountValue");
  var chordTimeline = document.getElementById("chordTimeline");
  var summaryValue = document.getElementById("summaryValue");

  /* --- sticky nav: add border once scrolled --- */
  function onScroll() {
    if (!nav) return;
    nav.classList.toggle("nav--scrolled", window.scrollY > 8);
  }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* --- mobile menu --- */
  function closeMenu() {
    if (!links || !toggle) return;
    links.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });

    // close after tapping a link
    links.addEventListener("click", function (e) {
      if (e.target.closest("a")) closeMenu();
    });

    // close on Escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeMenu();
    });
  }

  function setStatus(message, isError) {
    if (!analyzeStatus) return;
    analyzeStatus.textContent = message;
    analyzeStatus.classList.toggle("is-error", Boolean(isError));
  }

  function formatTime(value) {
    return Number(value).toFixed(2) + "s";
  }

  function renderChordTimeline(chordEstimates) {
    if (!chordTimeline) return;
    chordTimeline.innerHTML = "";

    if (!chordEstimates || chordEstimates.length === 0) {
      var empty = document.createElement("li");
      empty.className = "detected-timeline__empty";
      empty.textContent = "No supported chords were detected.";
      chordTimeline.appendChild(empty);
      return;
    }

    chordEstimates.forEach(function (estimate, index) {
      var item = document.createElement("li");
      item.className = "detected-chord";

      var number = document.createElement("small");
      number.textContent = String(index + 1).padStart(2, "0");

      var chord = document.createElement("strong");
      chord.textContent = estimate.chord || "Unknown";

      var meta = document.createElement("span");
      meta.textContent = formatTime(estimate.start) + " - " + formatTime(estimate.end) +
        " · " + Math.round((estimate.confidence || 0) * 100) + "%";

      item.appendChild(number);
      item.appendChild(chord);
      item.appendChild(meta);
      chordTimeline.appendChild(item);
    });
  }

  function renderAnalysis(data) {
    var chordEstimates = data.chord_estimates || [];
    if (tempoValue) tempoValue.textContent = Number(data.estimated_tempo_bpm || 0).toFixed(1);
    if (chordCountValue) chordCountValue.textContent = String(chordEstimates.length);
    if (onsetCountValue) {
      var onsetCount = (data.onset_times_seconds || []).length;
      onsetCountValue.textContent = onsetCount + (onsetCount === 1 ? " strum" : " strums");
    }
    if (summaryValue) summaryValue.textContent = data.summary || "";
    renderChordTimeline(chordEstimates);
  }

  if (audioFile && fileName) {
    audioFile.addEventListener("change", function () {
      var file = audioFile.files && audioFile.files[0];
      fileName.textContent = file ? file.name : "Choose WAV, MP3, M4A, FLAC, OGG, or AAC";
    });
  }

  if (analyzeForm && audioFile) {
    analyzeForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var file = audioFile.files && audioFile.files[0];
      if (!file) {
        setStatus("Choose an audio file first.", true);
        return;
      }

      var body = new FormData();
      body.append("file", file);

      if (analyzeButton) analyzeButton.disabled = true;
      setStatus("Analyzing recording...", false);

      fetch("/analyze", { method: "POST", body: body })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) {
              throw new Error(data.detail || "Analysis failed.");
            }
            return data;
          });
        })
        .then(function (data) {
          renderAnalysis(data);
          setStatus("Analysis complete.", false);
        })
        .catch(function (error) {
          setStatus(error.message || "Could not analyze this recording.", true);
        })
        .finally(function () {
          if (analyzeButton) analyzeButton.disabled = false;
        });
    });
  }

  /* --- scroll reveal --- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry, i) {
      if (entry.isIntersecting) {
        // tiny stagger for elements that enter together
        var delay = Math.min(i * 60, 180);
        setTimeout(function () { entry.target.classList.add("is-visible"); }, delay);
        io.unobserve(entry.target);
      }
    });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });

  revealEls.forEach(function (el) { io.observe(el); });
})();
