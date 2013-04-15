"use strict";

function log() {
  if (window.console)
    window.console.log.apply(window.console, arguments);
}

function timeToStr(seconds) {
  var isNeg = seconds < 0;
  if (isNeg)
    seconds *= -1;
  var microsStr = ("0" + parseInt((seconds * 100) % 100)).slice(-2);
  var secondsStr = ("0" + parseInt(seconds % 60)).slice(-2);
  var minutesStr = ("0" + parseInt(seconds / 60)).slice(-2);
  return (isNeg? "-" : "") + minutesStr + ":" + secondsStr + "." + microsStr;
}

function strToTime(str) {
  // Parse a time from a str
  // strToTime("1") -> 1.0
  // strToTime("1.5") -> 1.5
  // strToTime("1:05") -> 65.0
  // strToTime("1:5") -> 110.0
  var time = 0;
  var multipliers = [1, 60, 60 * 60];
  var split = str.split(":");
  for (var i = split.length - 1; i >= 0; i -= 1) {
    var part = split[split.length - i - 1];
    if (part.length == 0)
      continue;
    time += parseFloat(part) * (multipliers[i] || 0);
  }
  return time;
}

function toggleClassPrefix(elems, prefix, toAdd) {
  return elems.each(function() {
    var newClass = $.grep(this.className.split(/\s+/), function(cls) {
      return cls.indexOf(prefix) != 0;
    });
    if (toAdd)
      newClass.push(toAdd);
    this.className = newClass.join(" ");
  });
}

function toggleVisible(elems, commonClass, toShow) {
  elems.find("." + commonClass).hide();
  elems.find("." + toShow).show();
}

function LectureMode() {
  var self = {};
  self.keyboardShortcuts = {};

  self.activate = function(lecture) {
    self.lecture = lecture;
    self._activate();
  };

  self._activate = function() {};

  self.deactivate = function() {
    self._deactivate();
    self.lecture = null;
  }

  self._deactivate = function() {};

  self.loadFromNotebook = function() {
    if (self._didLoadFromNotebook)
      return;
    self._loadFromNotebook();
    self._didLoadFromNotebook = true;
  };

  self._loadFromNotebook = function() {};

  return self;
}

function LectureRecording() {
  var self = LectureMode();

  self.keyboardShortcuts = {
    m: {
      help: "Mark current cell",
      action: function() {
        self.markSelection();
      }
    }
  };

  self._loadFromNotebook = function() {
    self.setupAllCellControls();
    self.recalculateTimings();
  };

  self._activate = function() {
    // Add the 'pick audio' button
    self.pickAudioBtn = $(
      "<button class='set-audio-url button'>Pick audio URL</button>"
    );
    self.pickAudioBtn.button({
      icons: { primary: "ui-icon-folder-open" },
      text: "Pick audio URL",
    });
    self.pickAudioBtn.click(self.pickAudioURL);
    self.lecture.audioContainer.after(self.pickAudioBtn);

    // Setup the cell timings
    if (self._didLoadFromNotebook) {
      self._loadFromNotebook();
    }

    // Inject the time coding stuff into cells
    $([IPython.events]).on("selected_cell_type_changed.Notebook", self.onSelectCell);
  }

  self._deactivate = function() {
    self.pickAudioBtn.remove();
    self.pickAudioBtn = null;
    $([IPython.events]).off("selected_cell_type_changed.Notebook", self.onSelectCell);
    self.teardownAllCellControls();
  };

  self.cellOpts = function(cell) {
    if (!cell._nblecture) {
      if (!cell.metadata.nblecture)
        cell.metadata.nblecture = {};
      cell._nblecture = {
        meta: cell.metadata.nblecture
      };
    }
    return cell._nblecture;
  };

  self.onSelectCell = function() {
    // Because the Notebook doesn't currently trigger any explicit event when a
    // cell is created, we need to check to see if the current cell needs
    // controls each time the selection is changed.
    if (!self._didLoadFromNotebook)
      return;
    var cell = IPython.notebook.get_selected_cell();
    self.setupCellControls(cell);
    self.recalculateTimings();
  };

  self.setupAllCellControls = function() {
    var cells = IPython.notebook.get_cells();
    for (var i = 0; i < cells.length; i += 1) {
      self.setupCellControls(cells[i]);
    }
  };

  self.teardownAllCellControls = function() {
    var cells = IPython.notebook.get_cells();
    for (var i = 0; i < cells.length; i += 1) {
      var cell = cells[i];
      var cellOpts = self.cellOpts(cell);
      if (!cellOpts.controls)
        continue;
      cellOpts.controls.remove();
      cellOpts.controls = null;
    }
  };

  self.setupCellControls = function(cell) {
    var cellOpts = self.cellOpts(cell);
    if (cellOpts.controls)
      return;
    cellOpts.controls = self.createCellControls();
    cellOpts.timeInput = cellOpts.controls.find(".nblecture-start-time-input");
    cellOpts.durationInput = cellOpts.controls.find(".nblecture-duration-input");
    $(cell.element).prepend(cellOpts.controls);
  };

  self.createCellControls = function() {
    var controls = $(
      "<div class='nblecture-controls'>" +
        "<div class='input-container'>" +
          "<span class='ui-icon ui-icon-arrowstop-1-n'></span>" +
          "<input class='nblecture-start-time-input' placeholder='Start' title='Cell start time' />" +
        "</div>" +
        "<div class='input-container'>" +
          "<span class='ui-icon ui-icon-arrowstop-1-e'></span>" +
          "<input class='nblecture-duration-input' placeholder='Duration' title='Cell duration'/>" +
        "</div>" +
      "</div>"
    );

    controls.find("input").on("keypress blur", function(event) {
      if (event.type == "keypress" && event.which != 13) // enter
        return;
      self.commitTimeEdit();
    });

    return controls;
  };

  self.pickAudioURL = function() {
    var dialog = $(
      "<div class='nblecture-pick-audio-url'>" +
        "<p>Enter a URL to use for audio:</p>" +
        "<input type='text' name='audio-url' />" +
      "</div>"
    );
    dialog.find("[name=audio-url]").val(self.lecture.audioURL || "");
    dialog.dialog({
      buttons: {
        Save: function() {
          self.lecture.setAudioURL($(this).find("[name=audio-url]").val());
          IPython.notebook.save_notebook();
          $(this).dialog("close");
        },
        Cancel: function() {
          $(this).dialog("close");
        }
      }
    });
  };

  /**
   * Recalculates the cell times and durations, updating the input fields, meta
   * fields, and cellOpts fields.
   * Assumes that:
   * - If the input field is empty, the time needs to be calculated from the
   *   meta time.
   * - If the time input field is different from the meta time, subsequent
   *   cells should be shifted by the difference.
   * - If the duration input field is different from the value calculated
   *   from the meta time, subsequent cells should be shifted by the
   *   difference.
   * Or, intutively: if an input field changes, subsequent timings should be
   * shifted so that change "makes sense".
   * No guarantees are made about the sensibility of the result if multiple
   * input fields are changed.
   */
  self.recalculateTimings = function() {
    var cells = IPython.notebook.get_cells();
    var lastOpts = null;
    var curTime = 0;
    var curOffset = 0;
    var timeOffset = 0;
    for (var i = 0; i < cells.length; i += 1) {
      var cell = cells[i];
      var cellOpts = self.cellOpts(cell);
      var curTimeStr = cellOpts.timeInput.val();

      // This cell's timing, according to it's metadata (the "saved time").
      var metaTime = cellOpts.meta.time || 0;

      // The time that will be used for this cell, before 'timeOffset' has been
      // applied (if the last cell's duration was changed, 'timeOffset' may be
      // adjusted)
      curTime = curTimeStr? strToTime(curTimeStr) : metaTime;

      // The offset introduced by this cell. Will be applied to 'timeOffset'
      // after this cell's time has been saved.
      curOffset = curTime - metaTime;
      if (curOffset != 0) {
        self.lecture.showLog(
          "Adjusting time from " + timeToStr(metaTime) + " " +
          "to " + timeToStr(curTime) + "."
        );
      }

      if (lastOpts) {
        if (!lastOpts.duration)
          lastOpts.durationInput.parent().show();

        var durationStr = lastOpts.durationInput.val();
        // The duration that will be used for the previous cell, before
        // adjusting for the time offset that may be introduced by 'curOffset'.
        var duration = durationStr? strToTime(durationStr) : curTime - lastOpts.time;
        duration = Math.max(duration, 0);

        if (curOffset) {
          // If the time of the current cell was changed, adjust the duration
          // accordingly.
          duration += curOffset;
          duration = Math.max(duration, 0);
        } else if (lastOpts.duration !== null && lastOpts.duration !== undefined) {
          // If the time of the current cell was not changed *and* if we have
          // previously seen a duration for the last cell, update the time
          // offset that will be applied to the current cell and all subsequent
          // cells (ex, if the last cell's duration was changed from '1.0' to
          // '2.0', all subsequent cells will be shifted forward 1 second).
          timeOffset = (lastOpts.time + duration) - curTime;
        }
        lastOpts.duration = duration;
        lastOpts.durationInput.val(timeToStr(lastOpts.duration));
      }
      // Things are straight forward from here on: update the current cell's
      // time, adjusting for any offset that may have been introduced by
      // 'timeOffset'.
      cellOpts.time = Math.max(lastOpts? lastOpts.time : 0, curTime + timeOffset);
      cellOpts.meta.time = cellOpts.time;
      cellOpts.timeInput.val(timeToStr(cellOpts.time));
      lastOpts = cellOpts;
      timeOffset += curOffset;
    }

    if (lastOpts) {
      // Hide the duration input for the last cell, because it doesn't make
      // sense to either show or edit it.
      lastOpts.duration = null;
      cellOpts.durationInput.parent().hide();
    }
  };

  self.markSelection = function() {
    var cell = IPython.notebook.get_selected_cell();
    var cellOpts = self.cellOpts(cell);
    var time = self.lecture.getCurrentTime()
    var timeStr = timeToStr(time);
    cellOpts.timeInput.val(timeStr);
    self.recalculateTimings();
    IPython.notebook.save_notebook();
  };

  self.commitTimeEdit = function() {
    self.recalculateTimings();
    IPython.notebook.save_notebook();
  };

  return self;
}

function LecturePlayback() {
  var self = LectureMode();

  self._activate = function(lecture) {
    self.audio = self.lecture.audio;
    self.setupPopcornEvents();
  };

  self._deactivate = function() {
    self.teardownPopcornEvents();
    self.audio = null;
  };

  self.cellClassPrefix = "nblecture-cell-";
  self.toggleCellClass = function(cellDom, newClassSuffix) {
    var newClass = newClassSuffix? self.cellClassPrefix + newClassSuffix : "";
    toggleClassPrefix(cellDom, self.cellClassPrefix, newClass);
  };

  self.popcornPlugin = {
    _setup: function(options){
      self.toggleCellClass(options.cellDom, "hidden");
    },
    _teardown:  function(options) {
      self.toggleCellClass(options.cellDom, null);
    },
    start: function(event, options){
      self.toggleCellClass(options.cellDom, "active");
      IPython.notebook.select(options.cellIndex);
    },
    end: function(event, options){
      self.toggleCellClass(options.cellDom, "inactive");
      IPython.notebook.select(Math.max(options.cellIndex - 1, 0));
    },
    toString: function(options){
      return "[nblectureCell start=" + options.start + "]";
    }
  };

  self.setupPopcornEvents = function() {
    Popcorn.plugin("nblectureCell", self.popcornPlugin);
    var cells = IPython.notebook.get_cells();
    var cellElements = IPython.notebook.get_cell_elements();
    var curMark = { time: 0 };
    var end = self.audio.duration() + 1;
    cells.forEach(function(cell, index) {
      curMark = cell.metadata.nblecture || curMark;
      self.audio.nblectureCell({
        start: curMark.time,
        end: end,
        cellDom: $(cellElements[index]),
        cellIndex: index
      });
    });
  };

  self.teardownPopcornEvents = function() {
    Popcorn.removePlugin(self.audio, "nblectureCell");
    Popcorn.removePlugin("nblectureCell");
  };

  return self;
}

function Lecture() {
  var self = {};
  self = $.extend(self, {
    events: $(self),
    modes: {
      recording: LectureRecording(),
      playback: LecturePlayback(),
    }
  });

  self.keyboardShortcuts = {
    j: {
      help: "Select next cell",
      action: function() {
        self.moveSelection(+1);
      }
    },
    k: {
      help: "Select previous cell",
      action: function() {
        self.moveSelection(-1);
      }
    },
    p: {
      help: "Play/pause audio",
      action: function() {
        self.togglePlayPause();
      }
    },
    r: {
      help: "Resume audio playback",
      action: function() {
        self.togglePlayPause(true);
      }
    },
    b: {
      help: "Back 3 seconds",
      action: function() {
        self.audioJump(-3);
      }
    },
    s: {
      help: "Stop audio playback",
      action: function() {
        self.togglePlayPause(false);
      }
    },
    h: {
      help: "Show help",
      action: function() {
        self.showKeyboardShortcuts();
      }
    }
  };

  self.setup = function() {
    self.injectHTML();
    self.updateMode();
    self.setupEvents();
  };

  self.injectHTML = function() {
    self.view = $(
      "<div class='nblecture-container'>" +
        "<div class='mode-select'>" +
          "<input type='radio' id='nblecture-mode-record' name='mode' value='recording' checked />" +
          "<label for='nblecture-mode-record'>Recording</label>" +
          "<input type='radio' id='nblecture-mode-playback' name='mode' value='playback' />" +
          "<label for='nblecture-mode-playback'>Playback</label>" +
        "</div>" +
        "<div class='audio-container'>" + 
          "<span class='state state-empty'>No audio loaded&hellip;</span>" +
          "<span class='state state-loading'>Loading&hellip;</span>" +
          "<span class='state state-error'>Error loading audio.</span>" +
        "</div>" +
        "<div class='log'></div>" +
      "</div>"
    );
    $("body").append(self.view);
    self.view.find(".mode-select").buttonset();
    self.audioContainer = self.view.find(".audio-container");
    self.audioContainer.attr("id", "nblecture-audio-container")
    self.setAudioURL();
    self.log = self.view.find(".log");
  };

  self.setupEvents = function() {
    self.view.find(".mode-select input").change(self.updateMode);
    $([IPython.events]).on('notebook_saving.Notebook', function() {
      self.saveToNotebook();
    });
    $([IPython.events]).on('notebook_loaded.Notebook', function() {
      self.loadFromNotebook();
    });
    if (IPython.notebook && IPython.notebook.metadata) {
      self.loadFromNotebook();
    };

    $(document).keydown(function (event) {
      if (event.which === 76 && event.ctrlKey && !self._keyboard_active) {
        // ctrl-l to begin lecture-mode commands
        self._keyboard_active = true;
        return false;
      } else if (self._keyboard_active) {
        var chr = String.fromCharCode(event.which).toLowerCase();
        var handler = self.keyboardShortcuts[chr];
        if (!handler)
          handler = self.activeMode.keyboardShortcuts[chr];
        if (handler) {
          handler.action();
        }
        self._keyboard_active = false;
        return false;
      };
      return true;
    });
  };

  self.updateMode = function() {
    var name = self.view.find("input[name=mode]:checked").val();
    self.setMode(name);
  }

  self.setMode = function(name) {
    var newMode = self.modes[name];
    if (!newMode) {
      alert("Error: invalid mode: " + name);
      return;
    }
    if (newMode === self.activeMode)
      return;
    if (self.activeMode)
      self.activeMode.deactivate();
    self.activeMode = newMode;
    if (self._didLoadFromNotebook)
      self.activeMode.loadFromNotebook();
    self.activeMode.activate(self);
  };

  self.showLog = function(msg) {
    self.log.text(msg);
  };

  self.saveToNotebook = function() {
    var lecture = {};
    ["audioURL"].forEach(function(key) {
      lecture[key] = self[key];
    });
    IPython.notebook.metadata.lecture = lecture;
  };

  self.loadFromNotebook = function() {
    if (self._didLoadFromNotebook)
      return;
    var lecture = IPython.notebook.metadata.lecture || {};
    self.setAudioURL(lecture.audioURL);
    self.activeMode.loadFromNotebook();
    self._didLoadFromNotebook = true;
  };

  self.moveSelection = function(delta) {
    while (delta > 0) {
      IPython.notebook.select_next();
      delta -= 1;
    }

    while (delta < 0) {
      IPython.notebook.select_prev();
      delta += 1;
    }
  };

  self.togglePlayPause = function(forcePlay) {
    if (forcePlay === undefined)
      forcePlay = self.audio.paused();
    if (forcePlay) {
      self.audio.play();
      self.showLog("Playing...");
    } else {
      self.audio.pause();
      self.showLog("Paused.");
    }
  };

  self.audioJump = function(offset) {
    self.audio.currentTime(self.getCurrentTime() + offset);
  };

  self.showKeyboardShortcuts = function() {
    var shortcutsHTML = [];
    var shortcuts = $.extend({},
      self.keyboardShortcuts,
      self.activeMode.keyboardShortcuts
    );
    for (var key in shortcuts) {
      if (shortcuts.hasOwnProperty(key)) {
        var handler = shortcuts[key];
        shortcutsHTML.push(
          "<div>" +
            "<span class='shortcut_key'>Ctrl-l " + key + "</span>" +
            "<span class='shortcut_descr'>: " + handler.help + "</span>" +
          "</div>"
        );
      }
    }
    var dialog = $(
      "<div class='nblecture-shortcut-help'>" +
        shortcutsHTML.join("\n") +
      "</div>"
    );
    dialog.dialog({
      title: "Lecture Mode Keyboard Shortcuts"
    });
  };

  self.setAudioURL = function(value) {
    if (self.audio)
      $(self.audio.media).remove();
    self.audioURL = value;
    self.audio = null;
    toggleVisible(self.audioContainer, "state", "state-empty");
    if (!value)
      return;
    toggleVisible(self.audioContainer, "state", "state-loading");
    self.audio = Popcorn.smart("#" + self.audioContainer.attr("id"), [value]);
    self.audio.on("canplay", function() {
      $(self.audio.media).css({ "display": "inline" });
      toggleVisible(self.audioContainer, "state", "state-loaded");
    });
    self.audio.on("error", function(e) {
      toggleVisible(self.audioContainer, "state", "state-error");
      var msg = self.friendlyMediaError(self.audio.error);
      self.audioContainer.find(".state-error").text("Error loading media: " + msg + ".");
      self.audio = null;
    });
  };

  self.friendlyMediaError = function(err) {
    err = err || {};
    switch (err.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return "load was aborted";
      case MediaError.MEDIA_ERR_DECODE:
        return "error decoding media";
      case MediaError.MEDIA_ERR_NETWORK:
        return "network error";
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return "source format not supported";
    }
    return "unknown error (code: '" + err.code + "')";
  };

  self.getCurrentTime = function() {
    return self.audio.currentTime();
  };

  return self;
};

var lecture = Lecture();
lecture.setup();
