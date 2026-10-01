(function () {
  var params = new URLSearchParams(window.location.search);
  var theme = params.get('theme');
  if (theme) document.documentElement.dataset.theme = theme;
})();
