function parseParams() {
  var map = {};
  window.location.search.replace(
    /[?&#]+([^=&]+)=([^&]*)/gi,
    function (m, key, value) {
      map[key] = value;
    }
  );
  window.location.hash.replace(
    /[?&#]+([^=&]+)=([^&]*)/gi,
    function (m, key, value) {
      map[key] = value;
    }
  );
  return map;
}

function parseStartTime() {
  var params = parseParams();
  if (typeof params.t === "undefined") {
    return 0;
  }

  var startTime = 0;
  var extractNumber = /\d+/g;
  var extractUnit = /\D+/g;

  while (true) {
    var value = extractNumber.exec(params.t);
    var unit = extractUnit.exec(params.t);
    if (value == null || unit == null) break;

    unit = String(unit).toLowerCase();
    value = parseInt(String(value), 10);

    if (unit == "h") value *= 3600;
    else if (unit == "m") value *= 60;

    startTime += value;
  }
  return startTime;
}

Popcorn(function () {
  var vjs = videojs("video", {
    techOrder: ["html5"],
    playbackRates: [1, 1.25, 1.5, 2],
  });

  vjs.ready(function () {
    var popcorn = Popcorn("#video_html5_api", {
      defaults: {
        chattimeline: {
          target: "chat",
        },
      },
    });

    var t = parseStartTime();
    if (t > 0) popcorn.currentTime(t);

    window.addEventListener(
      "hashchange",
      function () {
        var new_t = parseStartTime();
        if (new_t != t) {
          t = new_t;
          popcorn.currentTime(t);
        }
      },
      false
    );

    if (navigator.userAgent.indexOf("Firefox") != -1) {
      var sources = popcorn.media.querySelectorAll("source");
      if (sources.length > 0) {
        var lastSource = sources[sources.length - 1];
        lastSource.addEventListener(
          "error",
          function (ev) {
            document.getElementById("firefox-format-warning").style.display =
              "block";
          },
          false
        );
      }
    }

    popcorn.parseXML("video.xml");
  });
});

document.addEventListener("DOMContentLoaded", () => {
  const openConfirmation = document.querySelector("button#open-confirmation");
  const video = document.querySelector("video");
  const h1 = document.querySelector("h1");
  const confirmationModal = document.querySelector("dialog#confirmation-modal");
  const downloadingModal = document.querySelector("dialog#downloading-modal");

  openConfirmation.addEventListener("click", () =>
    confirmationModal.showModal()
  );

  document.querySelector("button#confirm").addEventListener("click", () => {
    const downloadLink = document.createElement("a");
    downloadLink.href = video.src;
    downloadLink.download = `recording-${h1.innerText}.mp4`;
    confirmationModal.close();
    downloadingModal.showModal();
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  });
  document
    .querySelector("button#cancel")
    .addEventListener("click", () => confirmationModal.close());
  document
    .querySelectorAll("button.close")
    .forEach((button) =>
      button.addEventListener("click", () => button.parentElement.close())
    );
  document
    .querySelector("button#ok")
    .addEventListener("click", () => downloadingModal.close());
});
